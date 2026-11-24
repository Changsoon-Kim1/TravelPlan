/* 코스 상세 패널 (지도에서 코스를 누르면 열림) */
(function () {
  'use strict';
  const { $, $$, esc, fmtDay, fmtTimeRange, links, toast } = TPUtil;
  let currentId = null;

  const byId = (id) => window.OLLE_COURSES.find((c) => c.id === id);
  const shortNum = (c) => c.id.replace(/^0/, '');
  const courseQuery = (c) => '제주올레 ' + shortNum(c) + '코스';
  const islandOf = (c) => (c.id === '01-1' ? '우도' : c.id === '10-1' ? '가파도' : /^18-/.test(c.id) ? '추자도' : null);

  function diffBadge(d) {
    const cls = d === '하' ? 'lo' : d === '상' ? 'hi' : 'mid';
    return '<span class="diff ' + cls + '">' + esc(d) + ' ' + (d === '하' ? '★☆☆' : d === '상' ? '★★★' : '★★☆') + '</span>';
  }
  const ext = (href, label, cls) => '<a class="' + (cls || 'lnk') + '" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';

  function scheduleHTML(c) {
    const mine = S.events.filter((e) => e.course_id === c.id).sort(TPCore.compareEvents);
    const canEdit = TPData.canEdit();
    let h = '<section id="panelSchedule"><h3>📅 내 일정</h3>';
    if (mine.length) {
      h += '<ul class="sched-list">' + mine.map((e) =>
        '<li><div><b>' + esc(fmtDay(e.day)) + '</b> ' + esc(fmtTimeRange(e)) +
        (e.note ? '<div class="muted sm">' + esc(e.note) + '</div>' : '') + '</div>' +
        (canEdit ? '<div class="row-actions"><button class="icon-btn" data-edit="' + esc(e.id) + '" title="수정">✎</button>' +
          '<button class="icon-btn danger" data-del="' + esc(e.id) + '" title="삭제">🗑</button></div>' : '') + '</li>').join('') + '</ul>';
    } else {
      h += '<p class="muted">아직 일정에 추가하지 않았어요.</p>';
    }
    if (canEdit) h += '<button class="btn primary block" id="btnAddCourse">📅 일정에 추가 (시간 정하기)</button>';
    else h += '<p class="muted sm">읽기 전용 링크라서 일정을 추가할 수 없어요.</p>';
    return h + '</section>';
  }

  // ---- 시각 자료: 경로 모양 / 고도 프로필 (올린 GPX로 만든다) ----
  function shapeSVG(path, color) {
    const W = 320, H = 130, pad = 10;
    const lat0 = path.reduce((a, p) => a + p[0], 0) / path.length;
    const kx = Math.cos(lat0 * Math.PI / 180);
    const xs = path.map((p) => p[1] * kx), ys = path.map((p) => p[0]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const sc = Math.min((W - 2 * pad) / ((maxX - minX) || 1e-6), (H - 2 * pad) / ((maxY - minY) || 1e-6));
    const ox = (W - (maxX - minX) * sc) / 2, oy = (H - (maxY - minY) * sc) / 2;
    const P = path.map((p, i) => [ox + (xs[i] - minX) * sc, H - (oy + (ys[i] - minY) * sc)]);
    const pts = P.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ');
    const a = P[0], b = P[P.length - 1];
    return '<svg class="shape-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="코스 경로 모양(북쪽이 위)">' +
      '<polyline points="' + pts + '" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + a[0].toFixed(1) + '" cy="' + a[1].toFixed(1) + '" r="5" fill="#16a34a" stroke="#fff" stroke-width="2"/>' +
      '<circle cx="' + b[0].toFixed(1) + '" cy="' + b[1].toFixed(1) + '" r="5" fill="#dc2626" stroke="#fff" stroke-width="2"/>' +
      '<text x="' + (a[0] + 8).toFixed(1) + '" y="' + (a[1] - 6).toFixed(1) + '" font-size="10" font-weight="700" fill="#166534">시점</text>' +
      '<text x="' + (b[0] + 8).toFixed(1) + '" y="' + (b[1] - 6).toFixed(1) + '" font-size="10" font-weight="700" fill="#991b1b">종점</text></svg>';
  }
  function elevSVG(pr, color) {
    const W = 320, H = 120, L = 30, R = 8, T = 8, B = 18;
    const span = Math.max(pr.max - pr.min, 10), lo = pr.min - span * 0.05, hi = pr.max + span * 0.05;
    const X = (d) => L + (d / pr.total) * (W - L - R), Y = (e) => T + (1 - (e - lo) / (hi - lo)) * (H - T - B);
    const step = Math.max(1, Math.floor(pr.d.length / 120));
    let line = '';
    for (let i = 0; i < pr.d.length; i += step) line += (line ? ' ' : '') + X(pr.d[i]).toFixed(1) + ',' + Y(pr.e[i]).toFixed(1);
    const last = pr.d.length - 1;
    if ((last % step) !== 0) line += ' ' + X(pr.d[last]).toFixed(1) + ',' + Y(pr.e[last]).toFixed(1);
    const area = line + ' ' + X(pr.total).toFixed(1) + ',' + (H - B) + ' ' + L + ',' + (H - B);
    const km = Math.max(1, Math.round(pr.total / 5));
    let ticks = '';
    for (let k = 0; k <= pr.total + 0.01; k += km) ticks += '<text x="' + X(k).toFixed(1) + '" y="' + (H - 4) + '" font-size="9" text-anchor="middle" fill="#64748b">' + k + 'km</text>';
    return '<svg class="elev-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="고도 프로필">' +
      '<polygon points="' + area + '" fill="' + color + '" fill-opacity=".18"/>' +
      '<polyline points="' + line + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>' +
      '<line x1="' + L + '" y1="' + Y(pr.max).toFixed(1) + '" x2="' + (W - R) + '" y2="' + Y(pr.max).toFixed(1) + '" stroke="#e2e8f0" stroke-dasharray="3 3"/>' +
      '<line x1="' + L + '" y1="' + Y(pr.min).toFixed(1) + '" x2="' + (W - R) + '" y2="' + Y(pr.min).toFixed(1) + '" stroke="#e2e8f0" stroke-dasharray="3 3"/>' +
      '<text x="' + (L - 3) + '" y="' + (Y(pr.max) + 3).toFixed(1) + '" font-size="9" text-anchor="end" fill="#64748b">' + Math.round(pr.max) + 'm</text>' +
      '<text x="' + (L - 3) + '" y="' + (Y(pr.min) + 3).toFixed(1) + '" font-size="9" text-anchor="end" fill="#64748b">' + Math.round(pr.min) + 'm</text>' + ticks + '</svg>';
  }

  // 이 길은 어떤 길? — 공식 안내를 줄여 쓴 소개 + 경로 모양 + 고도
  function overviewHTML(c, color) {
    const x = (window.OLLE_EXTRA || {})[c.id];
    const path = S.routes && S.routes[c.id];
    const prof = path ? TPCore.elevationProfile(path) : null;
    let h = '<section class="overview"><h3>📖 이 길은 어떤 길?</h3>';
    if (x && x.notice) h += '<div class="warn-box">⚠ ' + esc(x.notice) + '</div>';
    if (x && x.story) h += '<p class="story">' + esc(x.story) + '</p>';
    else h += '<p class="muted">이 코스는 공식 상세 설명을 아직 정리하지 못했어요(보강 예정). 아래 구경거리와 공식 홈페이지 링크를 참고하세요.</p>';
    if (x && x.road) h += '<div class="road"><b>걷는 느낌</b> ' + esc(x.road) + '</div>';
    if (path && path.length > 1) h += '<div class="vis"><div class="vis-t">경로 모양 <small>(북쪽이 위 · 초록 시점 → 빨강 종점)</small></div>' + shapeSVG(path, color) + '</div>';
    if (prof) {
      h += '<div class="vis"><div class="vis-t">고도 프로필</div>' + elevSVG(prof, color) +
        '<div class="elev-stats"><span>↑ 누적 오르막 <b>' + Math.round(prof.up) + 'm</b></span><span>↓ 내리막 <b>' + Math.round(prof.down) + 'm</b></span>' +
        '<span>최고 <b>' + Math.round(prof.max) + 'm</b></span><span>최저 <b>' + Math.round(prof.min) + 'm</b></span></div></div>';
    } else if (path && TPData.isOwner()) {
      h += '<p class="muted sm">⛰ 고도 그래프는 고도(ele)가 들어 있는 GPX를 다시 올리면 나타나요.</p>';
    }
    if (x && x.sights && x.sights.length) {
      h += '<div class="vis-t">길에서 만나는 곳</div><ul class="sights">' + x.sights.map((s) =>
        '<li><div><b>' + esc(s.n) + '</b><div class="muted sm">' + esc(s.d) + '</div></div>' + findBtn(s.n, '🔍', 'find-icon', '') + '</li>').join('') + '</ul>';
    }
    if (x && x.tip) h += '<div class="official-tip"><b>공식 팁</b> ' + esc(x.tip) + '</div>';
    if (x && x.center) h += '<div class="muted sm">📍 안내: ' + esc(x.center) + '</div>';
    h += '<div class="muted sm src">출처: ' + ext(window.OLLE_OFFICIAL_URL || 'https://www.jejuolle.org/trail', '제주올레 공식 홈페이지') + ' 코스 안내를 요약한 내용이에요.</div>';
    return h + '</section>';
  }

  function render(c) {
    const color = S.colors[c.id] || '#0f766e';
    const exact = TPMap.isExact(c.id);
    const q = courseQuery(c);
    const spring = window.OLLE_SPRING_IDS.includes(c.id);
    const island = islandOf(c);

    let h = '<div class="panel-head" style="border-top-color:' + color + '">' +
      '<button class="close" id="panelClose" aria-label="닫기">✕</button>' +
      '<div class="code"><span class="dot" style="background:' + color + '"></span>' + esc(c.code) + ' · ' + esc(c.region) +
      (c.isIsland ? ' · 섬' : '') + (spring ? ' · 🌸 4월 추천' : '') + '</div>' +
      '<h2>' + esc(c.name) + '</h2>' +
      '<div class="muted">시점 <b>' + esc(c.start) + '</b> → 종점 <b>' + esc(c.end) + '</b></div></div>';

    h += '<div class="panel-body">';
    h += '<div class="stats"><div><small>거리</small><b>' + c.distance.toFixed(1) + 'km</b></div>' +
      '<div><small>예상 시간</small><b>' + esc(c.timeText) + '</b></div>' +
      '<div><small>난이도</small>' + diffBadge(c.difficulty) + '</div></div>';

    if (!exact) {
      h += '<div class="warn-box">⚠ 지도의 점선은 <b>임시 대략 경로</b>(시점·종점 직선)예요. 공식 GPX를 올리면 실제 경로로 바뀝니다.</div>';
    }

    h += overviewHTML(c, color);
    h += scheduleHTML(c);

    h += '<section><h3>👀 구경거리 <small class="muted">(누르면 앱 지도에서 검색)</small></h3><div class="chips">' +
      c.highlights.map((x) => findBtn(x, '#' + x + ' 🔍', 'chip find')).join('') + '</div>' +
      '<p>' + esc(c.features) + '</p>' +
      '<div class="wps"><b>경유지</b> ' + c.waypoints.map((w) => findBtn(w, w + ' 🔍', 'wp find')).join(' → ') + '</div></section>';

    h += '<section><h3>🍽️ 맛집 · 카페</h3><ul class="rest-list">' + c.restaurants.map((r) =>
      '<li><div><b>' + esc(r.name) + '</b> <span class="menu">' + esc(r.menu) + '</span>' +
      '<div class="muted sm">📍 ' + esc(r.spot) + '</div></div>' +
      '<div class="rest-links">' + findBtn(r.name, '🔍 지도 검색', 'find-main', r.spot) + ext(links.naverMap('제주 ' + r.name), '네이버') + ext(links.kakaoMap('제주 ' + r.name), '카카오') + '</div></li>').join('') + '</ul></section>';

    h += '<section><h3>📷 사진 보기</h3>' +
      '<p class="muted sm">저작권 때문에 앱에 사진을 직접 넣지 않고, 검색 링크로 연결해요.</p>' +
      '<div class="chips">' + ext(links.naverImage(q), '📷 ' + esc(shortNum(c)) + '코스 사진 (네이버)', 'chip a') +
      ext(links.googleImage(q), '📷 구글 이미지', 'chip a') +
      ext(links.commons(q), '📷 위키미디어', 'chip a') +
      c.highlights.map((x) => ext(links.naverImage('제주 ' + x), '📷 ' + esc(x), 'chip a')).join('') + '</div></section>';

    h += '<section><h3>🔗 유용한 사이트</h3><div class="link-grid">' +
      ext(links.olleHome, '제주올레 공식 홈페이지') +
      ext(links.naverMap(q), '네이버 지도에서 코스 보기') +
      ext(links.kakaoMap(q), '카카오맵에서 보기') +
      ext(links.googleMap(q), '구글 지도에서 보기') +
      ext(links.naverBlog(q + ' 후기'), '걸어본 후기 (블로그)') +
      ext(links.jejuBus, '제주 버스 정보 (복귀 교통)') +
      (island ? ext(links.naverBlog(island + ' 배편 예약'), '⛴ ' + island + ' 배편 · 예약') : '') +
      (spring ? ext(links.naverBlog('제주 유채꽃 청보리 ' + c.name + ' 개화'), '🌸 유채·청보리 개화 정보') : '') +
      '</div></section>';

    h += '<section><h3>💡 실전 팁</h3><p>' + esc(c.tip) + '</p></section>';
    h += '</div>';
    return h;
  }

  // 앱 지도에서 검색하는 버튼. 이름이 설명형이어도 찾도록 검색어 후보를 여러 개 달아 둔다.
  function findBtn(name, label, cls, spot) {
    const terms = TPCore.searchTerms(name, spot);
    return '<button type="button" class="' + cls + '" data-find="' + esc(JSON.stringify(terms)) + '">' + esc(label) + '</button>';
  }

  function bind(c) {
    const panel = $('#panel');
    $('#panelClose', panel).addEventListener('click', () => TPPanel.close());
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-find]');
      if (b) { try { App.findOnMap(JSON.parse(b.dataset.find)); } catch (err) { /* 무시 */ } }
    });
    wireSchedule(c);
  }
  function wireSchedule(c) {
    const panel = $('#panel');
    const add = $('#btnAddCourse', panel);
    if (add) add.addEventListener('click', () => TPDialogs.openCourseEventModal(c));
    $$('[data-edit]', panel).forEach((b) => b.addEventListener('click', () => {
      const ev = S.events.find((e) => e.id === b.dataset.edit);
      if (ev) TPDialogs.openEventModal({ event: ev });
    }));
    $$('[data-del]', panel).forEach((b) => b.addEventListener('click', () => TPDialogs.deleteEvent(b.dataset.del)));
  }

  const TPPanel = {
    current: () => currentId,
    open(id) {
      const c = byId(id);
      if (!c) return;
      currentId = id;
      S.selectedCourse = id;
      const panel = $('#panel');
      panel.innerHTML = render(c);
      panel.hidden = false;
      panel.scrollTop = 0;
      bind(c);
      TPMap.select(id);
    },
    close() {
      currentId = null;
      S.selectedCourse = null;
      $('#panel').hidden = true;
      TPMap.select(null);
    },
    /** 일정이 바뀌었을 때 일정 영역만 다시 그린다 */
    refreshSchedule() {
      if (!currentId) return;
      const c = byId(currentId);
      const old = $('#panelSchedule');
      if (!c || !old) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = scheduleHTML(c);
      old.replaceWith(tmp.firstChild);
      wireSchedule(c);
    },
    /** GPX를 올려 경로가 바뀐 경우 안내 문구까지 다시 그린다 */
    rerender() { if (currentId) TPPanel.open(currentId); }
  };
  window.TPPanel = TPPanel;
})();
