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

    h += scheduleHTML(c);

    h += '<section><h3>👀 구경거리</h3><div class="chips">' +
      c.highlights.map((x) => '<span class="chip">#' + esc(x) + '</span>').join('') + '</div>' +
      '<p>' + esc(c.features) + '</p>' +
      '<div class="wps"><b>경유지</b> ' + c.waypoints.map(esc).join(' → ') + '</div></section>';

    h += '<section><h3>🍽️ 맛집 · 카페</h3><ul class="rest-list">' + c.restaurants.map((r) =>
      '<li><div><b>' + esc(r.name) + '</b> <span class="menu">' + esc(r.menu) + '</span>' +
      '<div class="muted sm">📍 ' + esc(r.spot) + '</div></div>' +
      '<div class="rest-links">' + ext(links.naverMap('제주 ' + r.name), '네이버') + ext(links.kakaoMap('제주 ' + r.name), '카카오') + '</div></li>').join('') + '</ul></section>';

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

  function bind(c) {
    const panel = $('#panel');
    $('#panelClose', panel).addEventListener('click', () => TPPanel.close());
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
