/* 캘린더: 월 달력 + 목록 보기 + 날짜별 상세 */
(function () {
  'use strict';
  const { $, $$, esc, KIND, fmtDay, fmtTimeRange, todayISO } = TPUtil;
  const C = TPCore;

  const byId = (id) => window.OLLE_COURSES.find((c) => c.id === id);
  const monthOf = (iso) => iso.slice(0, 7);
  function shiftMonth(ym, delta) {
    let [y, m] = ym.split('-').map(Number);
    m += delta;
    while (m > 12) { m -= 12; y++; }
    while (m < 1) { m += 12; y--; }
    return y + '-' + C.pad2(m);
  }
  function eventColor(ev) {
    if (ev.course_id && S.colors[ev.course_id]) return S.colors[ev.course_id];
    return (KIND[ev.kind] || KIND.other).color;
  }
  function chipLabel(ev) {
    const c = ev.course_id && byId(ev.course_id);
    return c ? c.code : (KIND[ev.kind] || KIND.other).icon + ' ' + ev.title;
  }
  function inDayOrder(a, b) {
    const sa = C.toMin(a.start_time), sb = C.toMin(b.start_time);
    if (sa === null && sb !== null) return -1;
    if (sa !== null && sb === null) return 1;
    if (sa !== sb) return sa - sb;
    return (a.title || '').localeCompare(b.title || '');
  }
  const eventsOn = (iso) => S.events.filter((e) => C.eventCoversDay(e, iso)).sort(inDayOrder);

  function summaryHTML() {
    const olle = S.events.filter((e) => e.course_id && byId(e.course_id));
    const km = olle.reduce((s, e) => s + byId(e.course_id).distance, 0);
    const days = new Set(olle.map((e) => e.day)).size;
    return '<div class="cal-summary">🥾 올레 걷기 <b>' + olle.length + '개</b> 일정 · <b>' + days + '일</b> · 합계 <b>' + km.toFixed(1) + 'km</b></div>';
  }

  function gridHTML() {
    const [y, m] = S.calMonth.split('-').map(Number);
    const lead = C.weekday(C.toISO(y, m, 1)), dim = C.daysInMonth(y, m);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= dim; d++) cells.push(C.toISO(y, m, d));
    while (cells.length % 7) cells.push(null);
    const today = todayISO(), t = S.trip;
    let h = '<div class="cal-grid">' + TPUtil.WD.map((w, i) => '<div class="cal-wd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + w + '</div>').join('');
    cells.forEach((iso, i) => {
      if (!iso) { h += '<div class="cal-cell empty"></div>'; return; }
      const evs = eventsOn(iso);
      const cls = ['cal-cell'];
      if (iso >= t.start_date && iso <= t.end_date) cls.push('in-trip');
      if (iso === today) cls.push('today');
      if (iso === S.selectedDay) cls.push('selected');
      if (i % 7 === 0) cls.push('sun'); if (i % 7 === 6) cls.push('sat');
      h += '<button type="button" class="' + cls.join(' ') + '" data-day="' + iso + '"><span class="dn">' + Number(iso.slice(8)) + '</span>';
      evs.slice(0, 3).forEach((e) => {
        h += '<span class="chip-ev" style="border-left-color:' + eventColor(e) + '" title="' + esc(e.title) + '">' +
          (e.start_time ? '<i>' + esc(e.start_time) + '</i>' : '') + esc(chipLabel(e)) + '</span>';
      });
      if (evs.length > 3) h += '<span class="more">+' + (evs.length - 3) + '</span>';
      h += '</button>';
    });
    return h + '</div>';
  }

  function eventRow(ev, iso) {
    const k = KIND[ev.kind] || KIND.other;
    const canEdit = TPData.canEdit();
    const multi = ev.end_day && ev.end_day !== ev.day;
    const course = ev.course_id && byId(ev.course_id);
    let h = '<li class="ev" style="border-left-color:' + eventColor(ev) + '">' +
      '<div class="ev-time">' + esc(multi ? fmtDay(ev.day) + '~' + fmtDay(ev.end_day) : fmtTimeRange(ev)) + '</div>' +
      '<div class="ev-main"><b>' + k.icon + ' ' + esc(ev.title) + '</b>';
    if (course) h += '<div class="muted sm">' + course.distance.toFixed(1) + 'km · ' + esc(course.timeText) + ' · 난이도 ' + esc(course.difficulty) + '</div>';
    if (ev.place) h += '<div class="muted sm">📍 ' + esc(ev.place) + '</div>';
    if (ev.note) h += '<div class="muted sm">' + esc(ev.note) + '</div>';
    h += '</div><div class="row-actions">';
    if (course) h += '<button class="icon-btn" data-course="' + esc(course.id) + '" title="지도에서 코스 보기">🗺</button>';
    if (ev.lat != null) h += '<button class="icon-btn" data-pin="' + esc(ev.id) + '" title="지도에서 위치 보기">📍</button>';
    if (canEdit) h += '<button class="icon-btn" data-edit="' + esc(ev.id) + '" title="수정">✎</button>' +
      '<button class="icon-btn danger" data-del="' + esc(ev.id) + '" title="삭제">🗑</button>';
    return h + '</div></li>';
  }

  function dayHTML(iso) {
    const evs = eventsOn(iso);
    const canEdit = TPData.canEdit();
    let h = '<div class="day-panel"><div class="day-head"><h3>' + esc(fmtDay(iso)) + '</h3>' +
      (canEdit ? '<button class="btn small primary" data-add-day="' + iso + '">+ 일정 추가</button>' : '') + '</div>';
    h += evs.length ? '<ul class="ev-list">' + evs.map((e) => eventRow(e, iso)).join('') + '</ul>' : '<p class="muted">이 날은 일정이 없어요.</p>';
    return h + '</div>';
  }

  function listHTML() {
    const t = S.trip, days = new Set(C.dateRange(t.start_date, t.end_date));
    S.events.forEach((e) => days.add(e.day));
    const sorted = Array.from(days).sort(), today = todayISO();
    return '<div class="agenda">' + sorted.map((iso) => {
      const evs = eventsOn(iso);
      return '<section class="agenda-day' + (iso === today ? ' today' : '') + '"><div class="day-head"><h3>' + esc(fmtDay(iso)) +
        (iso < t.start_date || iso > t.end_date ? ' <small class="muted">(여행 기간 밖)</small>' : '') + '</h3>' +
        (TPData.canEdit() ? '<button class="btn small" data-add-day="' + iso + '">+ 추가</button>' : '') + '</div>' +
        (evs.length ? '<ul class="ev-list">' + evs.map((e) => eventRow(e, iso)).join('') + '</ul>' : '<p class="muted sm">일정 없음</p>') + '</section>';
    }).join('') + '</div>';
  }

  function render() {
    const root = $('#calRoot');
    if (!root || !S.trip) return;
    const t = S.trip;
    let h = '<div class="cal-bar">';
    if (S.calMode === 'grid') {
      const [y, m] = S.calMonth.split('-');
      h += '<div class="cal-nav"><button class="icon-btn" data-mnav="-1" aria-label="이전 달">◀</button><b>' + y + '년 ' + Number(m) + '월</b>' +
        '<button class="icon-btn" data-mnav="1" aria-label="다음 달">▶</button>' +
        '<button class="btn small" data-mjump="' + t.start_date + '">여행 달로</button></div>';
    } else {
      h += '<div class="cal-nav"><b>전체 일정</b></div>';
    }
    h += '<div class="seg"><button data-cmode="grid" class="' + (S.calMode === 'grid' ? 'on' : '') + '">달력</button>' +
      '<button data-cmode="list" class="' + (S.calMode === 'list' ? 'on' : '') + '">목록</button></div>' +
      '<button class="btn" data-report="1">📄 리포트</button>' +
      (TPData.canEdit() ? '<button class="btn primary" data-add-day="' + (S.selectedDay || t.start_date) + '">+ 일정 추가</button>' : '') + '</div>';
    h += summaryHTML();
    h += S.calMode === 'grid' ? gridHTML() + (S.selectedDay ? dayHTML(S.selectedDay) : '<p class="muted">날짜를 누르면 그날 일정이 보여요.</p>') : listHTML();
    root.innerHTML = h;
  }

  function init() {
    $('#calRoot').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      if (d.day) { S.selectedDay = d.day; render(); }
      else if (d.mnav) { S.calMonth = shiftMonth(S.calMonth, Number(d.mnav)); render(); }
      else if (d.mjump) { S.calMonth = monthOf(d.mjump); S.selectedDay = d.mjump; render(); }
      else if (d.cmode) { S.calMode = d.cmode; render(); }
      else if (d.report) { TPReport.open(); }
      else if (d.addDay) { TPDialogs.openEventModal({ defaults: { day: d.addDay } }); }
      else if (d.edit) { const ev = S.events.find((x) => x.id === d.edit); if (ev) TPDialogs.openEventModal({ event: ev }); }
      else if (d.del) { TPDialogs.deleteEvent(d.del); }
      else if (d.course) { App.showCourse(d.course); }
      else if (d.pin) { App.showPin(d.pin); }
    });
  }

  window.TPCalendar = { init, render };
})();
