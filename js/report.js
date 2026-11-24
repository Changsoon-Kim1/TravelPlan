/* 일정 요약 리포트: 화면으로 보고, 인쇄(PDF로 저장)할 수 있다. 데이터만으로 만든다(AI 호출 없음). */
(function () {
  'use strict';
  const { $, esc, KIND, fmtDay, fmtTimeRange, fmtTag } = TPUtil;
  const C = TPCore;
  const byId = (id) => window.OLLE_COURSES.find((c) => c.id === id);
  const md = (iso) => { const p = C.parseISO(iso); return p.m + '/' + p.d; };

  function eachDay(a, b) {
    const out = [];
    const [y, m, d] = a.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    for (let i = 0; i < 60; i++) {
      const iso = t.toISOString().slice(0, 10);
      if (iso > b) break;
      out.push(iso);
      t.setUTCDate(t.getUTCDate() + 1);
    }
    return out;
  }
  const isStay = (e) => e.kind === 'stay' || /숙박|호텔|숙소/.test(e.title || '') || (e.end_day && e.end_day > e.day);
  const dayOrder = (a, b) => {
    const sa = C.toMin(a.start_time), sb = C.toMin(b.start_time);
    if (sa === null && sb !== null) return -1;
    if (sa !== null && sb === null) return 1;
    return (sa || 0) - (sb || 0);
  };

  function build() {
    const t = S.trip;
    const days = eachDay(t.start_date, t.end_date);
    const evs = S.events.slice().sort(C.compareEvents);
    const olle = evs.filter((e) => e.course_id && byId(e.course_id));
    const km = olle.reduce((s, e) => s + byId(e.course_id).distance, 0);
    const walkDays = new Set(olle.map((e) => e.day)).size;
    const stays = evs.filter(isStay);
    const nights = days.slice(0, -1).filter((d) => evs.some((e) => isStay(e) && (e.end_day && e.end_day > e.day ? d >= e.day && d < e.end_day : e.day === d)));

    let h = '<div class="rp-bar no-print"><button class="btn" id="rpClose">← 닫기</button>' +
      '<button class="btn primary" id="rpPrint">🖨 PDF로 저장 / 인쇄</button></div>' +
      '<article class="rp-page">';
    h += '<header class="rp-head"><h1>' + esc(t.title || '제주 올레길 여행') + '</h1><div class="rp-sub">' +
      esc(fmtDay(t.start_date)) + ' ~ ' + esc(fmtDay(t.end_date)) + ' · ' + (days.length - 1) + '박 ' + days.length + '일 · 동행 2명</div></header>';

    h += '<section class="rp-sec"><h2>한눈에 보기</h2><div class="rp-stats">' +
      '<div><small>올레 코스</small><b>' + olle.length + '개</b></div>' +
      '<div><small>걷는 날</small><b>' + walkDays + '일</b></div>' +
      '<div><small>올레 거리(공식)</small><b>' + km.toFixed(1) + 'km</b></div>' +
      '<div><small>숙박 계획</small><b>' + nights.length + '/' + (days.length - 1) + '박</b></div></div></section>';

    // 날짜별
    h += '<section class="rp-sec"><h2>날짜별 일정</h2>';
    days.forEach((iso) => {
      const list = evs.filter((e) => C.eventCoversDay(e, iso)).sort(dayOrder);
      const dayKm = list.filter((e) => e.day === iso && e.course_id && byId(e.course_id)).reduce((s, e) => s + byId(e.course_id).distance, 0);
      h += '<div class="rp-day"><div class="rp-dh"><b>' + esc(fmtDay(iso)) + '</b>' + (dayKm ? '<span>🥾 ' + dayKm.toFixed(1) + 'km</span>' : '') + '</div>';
      if (!list.length) h += '<div class="rp-empty">일정 없음</div>';
      list.forEach((e) => {
        const k = KIND[e.kind] || KIND.other, c = e.course_id && byId(e.course_id);
        let time = e.day === iso ? fmtTimeRange(e) : '이어서';
        if (e.end_day && e.end_day > e.day) time = iso === e.day ? e.start_time ? e.start_time.slice(0, 5) + '~' : '종일' : iso === e.end_day ? '~' + (e.end_time || '').slice(0, 5) : '숙박 중';
        h += '<div class="rp-ev"><span class="rp-t">' + esc(time) + '</span><span class="rp-i">' + k.icon + '</span><div><b>' + esc(e.title) + '</b>' +
          (c ? ' <small>' + c.distance.toFixed(1) + 'km · ' + esc(c.timeText) + ' · 난이도 ' + esc(c.difficulty) + '</small>' : '') +
          (e.place && e.place !== e.title ? '<div class="rp-n">📍 ' + esc(e.place) + '</div>' : '') +
          (e.note && e.day === iso ? '<div class="rp-n">' + esc(e.note).replace(/\n+/g, '<br>') + '</div>' : '') + '</div></div>';
      });
      h += '</div>';
    });
    h += '</section>';

    // 숙박
    h += '<section class="rp-sec"><h2>숙박 계획</h2><table class="rp-tb"><tr><th>날짜</th><th>숙박 / 위치</th></tr>';
    days.slice(0, -1).forEach((iso) => {
      const s = stays.filter((e) => (e.end_day && e.end_day > e.day ? iso >= e.day && iso < e.end_day : e.day === iso));
      h += '<tr><td>' + esc(md(iso)) + '</td><td>' + (s.length ? s.map((e) => esc(e.place || e.title)).join(', ') : '<span class="rp-warn">미정</span>') + '</td></tr>';
    });
    h += '</table></section>';

    // 코스
    if (olle.length) {
      h += '<section class="rp-sec"><h2>걷는 코스</h2>';
      olle.forEach((e) => {
        const c = byId(e.course_id), x = (window.OLLE_EXTRA || {})[c.id];
        h += '<div class="rp-course"><div><b>' + esc(c.code) + ' ' + esc(c.name) + '</b> <small>' + esc(fmtTag(e)) + '</small>' +
          (window.OLLE_SPRING_IDS.includes(c.id) ? ' 🌸' : '') + '</div>' +
          '<div class="rp-n">' + esc(c.start) + ' → ' + esc(c.end) + ' · ' + c.distance.toFixed(1) + 'km · ' + esc(c.timeText) + ' · 난이도 ' + esc(c.difficulty) + '</div>' +
          (x && x.story ? '<div class="rp-n">' + esc(x.story) + '</div>' : '') + '</div>';
      });
      h += '</section>';
    }

    // 점검
    const warns = [];
    evs.forEach((e) => C.findOverlaps(e, evs, e.id).forEach((o) => { if (e.id < o.id) warns.push('시간 겹침: ' + md(e.day) + ' ' + e.title + ' ↔ ' + o.title); }));
    days.forEach((iso) => {
      const dk = olle.filter((e) => e.day === iso).reduce((s, e) => s + byId(e.course_id).distance, 0);
      if (dk >= 25) warns.push(md(iso) + ' 걷는 거리 ' + dk.toFixed(1) + 'km — 하루치로는 긴 편');
      else if (dk >= 18) warns.push(md(iso) + ' 걷는 거리 ' + dk.toFixed(1) + 'km — 체력·일몰 시각 확인');
      if (!evs.some((e) => C.eventCoversDay(e, iso))) warns.push(md(iso) + ' 일정 없음');
    });
    days.slice(0, -1).forEach((iso) => { if (!stays.some((e) => (e.end_day && e.end_day > e.day ? iso >= e.day && iso < e.end_day : e.day === iso))) warns.push(md(iso) + ' 숙박 미정'); });
    h += '<section class="rp-sec"><h2>점검할 점</h2>' + (warns.length ? '<ul class="rp-ul">' + warns.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '<p>특별히 걸리는 점이 없어요.</p>') + '</section>';

    h += '<footer class="rp-foot">만든 날 ' + esc(TPUtil.todayISO()) + ' · 코스 거리·시간은 제주올레 공식 안내 기준</footer></article>';
    return h;
  }

  function open() {
    if (!S.trip) return;
    const root = $('#reportRoot');
    root.innerHTML = build();
    root.hidden = false;
    document.body.classList.add('report-open');
    root.scrollTop = 0;
    $('#rpClose').onclick = close;
    $('#rpPrint').onclick = () => window.print();
  }
  function close() { const r = $('#reportRoot'); r.hidden = true; r.innerHTML = ''; document.body.classList.remove('report-open'); }

  window.TPReport = { open, close };
})();
