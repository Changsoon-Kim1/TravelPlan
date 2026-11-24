/* 앱 시작/화면 전환/상태 */
window.S = {
  trip: null, events: [], routes: {}, colors: {},
  view: 'map', selectedCourse: null,
  selectedDay: null, calMonth: '2027-04', calMode: 'grid', filter: 'all'
};

window.App = (function () {
  'use strict';
  const { $, $$, esc, fmtDay, toast } = TPUtil;
  const C = TPCore;
  let chromeReady = false, pollTimer = null;

  // 코스 id → 그 코스의 일정 목록(빠른 날짜순). Map이지만 .has(id)로 집합처럼도 쓴다.
  const scheduledSet = () => {
    const m = new Map();
    S.events.slice().sort(C.compareEvents).forEach((e) => { if (e.course_id) { if (!m.has(e.course_id)) m.set(e.course_id, []); m.get(e.course_id).push(e); } });
    return m;
  };
  const FILTERS = [
    { id: 'all', label: '전체', fn: () => true },
    { id: 'spring', label: '🌸 4월 유채·청보리', fn: (c) => window.OLLE_SPRING_IDS.includes(c.id) },
    { id: 'near', label: '🏨 중문·서귀포 (신라호텔 근처)', fn: (c) => c.region === '서귀포·중문' },
    { id: 'easy', label: '🐣 가벼운 코스', fn: (c) => c.difficulty === '하' },
    { id: 'sched', label: '✓ 내 일정', fn: (c) => scheduledSet().has(c.id) }
  ];
  const currentFilter = () => FILTERS.find((f) => f.id === S.filter) || FILTERS[0];

  // ---------- 화면 틀 (한 번만 설정) ----------
  function setupChrome() {
    if (chromeReady) return;
    chromeReady = true;
    S.colors = C.assignColors(window.OLLE_COURSES);

    $$('#tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

    $('#filterBar').innerHTML = FILTERS.map((f) => '<button type="button" data-f="' + f.id + '">' + esc(f.label) + '</button>').join('');
    $('#filterBar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      S.filter = b.dataset.f;
      applyFilter();
    });

    const menu = $('#menu');
    $('#menuBtn').addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      menu.hidden = true;
      const act = b.dataset.act;
      if (act === 'share') TPDialogs.openShareModal();
      else if (act === 'gpx') TPDialogs.openGpxModal();
      else if (act === 'refresh') refresh(false);
      else if (act === 'login') TPDialogs.openLoginModal();
      else if (act === 'logout') { TPData.logout(); resetState(); boot(); }
    });
    $('#mapNotice').addEventListener('click', (e) => { if (e.target.id === 'noticeGpx') TPDialogs.openGpxModal(); });

    $('#gateForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#gateGo'); btn.disabled = true; btn.textContent = '로그인 중…';
      try { await TPData.login($('#gateEmail').value.trim(), $('#gatePw').value); $('#gatePw').value = ''; await boot(); }
      catch (err) { setGateMsg(err.message, true); }
      btn.disabled = false; btn.textContent = '로그인';
    });
    $('#gateRetry').addEventListener('click', () => boot());

    TPCalendar.init();
    TPMap.init({ onSelect: (id) => TPPanel.open(id) });
    TPData.setAuthLostHandler(() => { resetState(); showGate('로그인이 만료되었어요. 다시 로그인해 주세요.'); });

    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.trip) refresh(true); });
    pollTimer = setInterval(() => { if (!document.hidden && S.trip && !$('#modalRoot').firstChild) refresh(true); }, 60000);
  }

  function resetState() {
    S.trip = null; S.events = []; S.routes = {};
    if (TPMap.ready()) TPMap.setRoutes({});
    TPPanel.close();
  }

  // ---------- 접속 화면(gate) ----------
  function setGateMsg(msg, isErr) {
    const el = $('#gateMsg');
    el.textContent = msg || '';
    el.className = isErr ? 'form-err' : 'muted';
    el.hidden = !msg;
  }
  function showGate(msg, opts) {
    $('#gate').hidden = false;
    setGateMsg(msg, !!(opts && opts.error));
    $('#gateRetry').hidden = !(opts && opts.retry);
  }
  function hideGate() { $('#gate').hidden = true; }

  // ---------- 화면 전환 ----------
  function showView(v) {
    S.view = v;
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    $('#viewMap').classList.toggle('on', v === 'map');
    $('#viewCal').classList.toggle('on', v === 'cal');
    if (v === 'map') setTimeout(() => TPMap.invalidate(), 30);
    else TPCalendar.render();
  }
  function showCourse(id) { showView('map'); TPPanel.open(id); }

  function applyFilter() {
    $$('#filterBar button').forEach((b) => b.classList.toggle('on', b.dataset.f === S.filter));
    TPMap.setFilter(currentFilter().fn);
  }

  function updateNotice() {
    const el = $('#mapNotice');
    if (!TPMap.ready()) { el.hidden = true; return; }
    const n = TPMap.exactCount(), total = window.OLLE_COURSES.length;
    el.hidden = n >= total;
    el.innerHTML = '⚠ 점선은 <b>임시 대략 경로</b>예요 (공식 경로 ' + n + '/' + total + ')' +
      (TPData.isOwner() ? ' <button type="button" id="noticeGpx">GPX 올리기</button>' : '');
  }

  function updateChrome() {
    const t = S.trip, mode = TPData.mode();
    $('#tripTitle').textContent = t.title;
    const nights = C.dateRange(t.start_date, t.end_date).length - 1;
    $('#tripDates').textContent = fmtDay(t.start_date) + ' ~ ' + fmtDay(t.end_date) + ' · ' + nights + '박 ' + (nights + 1) + '일';
    document.title = t.title + ' · 제주 여행 계획';
    const badge = $('#modeBadge');
    if (mode === 'owner') { badge.textContent = '내 계정'; badge.className = 'badge owner'; }
    else { badge.textContent = TPData.canEdit() ? '공유 링크' : '공유 링크 · 보기 전용'; badge.className = 'badge guest'; }
    $$('#menu [data-owner]').forEach((el) => { el.hidden = mode !== 'owner'; });
    $$('#menu [data-guest]').forEach((el) => { el.hidden = mode === 'owner'; });
    $('#menuUser').textContent = mode === 'owner' ? TPData.email() : '';
    $('#menuUser').hidden = mode !== 'owner';
  }

  function applyData(data, keepUI) {
    S.trip = data.trip; S.events = data.events.slice().sort(C.compareEvents); S.routes = data.routes || {};
    if (!keepUI) {
      const today = TPUtil.todayISO();
      S.selectedDay = (today >= S.trip.start_date && today <= S.trip.end_date) ? today : S.trip.start_date;
      S.calMonth = S.selectedDay.slice(0, 7);
    }
    TPMap.setRoutes(S.routes);
    TPMap.setScheduled(scheduledSet());
    updateChrome();
    updateNotice();
    applyFilter();
    TPCalendar.render();
    if (keepUI) TPPanel.refreshSchedule();
  }

  function afterEventsChanged() {
    S.events.sort(C.compareEvents);
    TPMap.setScheduled(scheduledSet());
    if (S.filter === 'sched') applyFilter();
    TPPanel.refreshSchedule();
    TPCalendar.render();
  }

  async function refresh(silent) {
    if (!S.trip) return;
    try {
      const data = await TPData.loadAll();
      const before = JSON.stringify([S.events, Object.keys(S.routes).length, S.trip.share_enabled, S.trip.share_can_edit, S.trip.can_edit]);
      const sorted = data.events.slice().sort(C.compareEvents);
      const after = JSON.stringify([sorted, Object.keys(data.routes || {}).length, data.trip.share_enabled, data.trip.share_can_edit, data.trip.can_edit]);
      if (before !== after) { applyData(data, true); if (!silent) toast('최신 내용으로 갱신했어요'); }
      else if (!silent) toast('이미 최신이에요');
    } catch (err) {
      if (!silent) toast(err.message || '새로고침하지 못했어요', 'err');
    }
  }

  // ---------- 시작 ----------
  async function boot() {
    setupChrome();
    try { await bootInner(); } finally { $('#loading').hidden = true; }
  }
  async function bootInner() {
    const mode = await TPData.init();
    if (mode === 'none') { showGate('로그인하거나, 받은 공유 링크로 접속해 주세요.'); return; }
    try {
      const data = await TPData.loadAll();
      applyData(data, false);
      hideGate();
      if (data.seeded) toast('기본 일정(항공·숙소)을 넣어 두었어요');
      showView(S.view);
    } catch (err) {
      if (err.raw === 'invalid_token') {
        TPData.forgetShareToken();
        showGate(err.message + ' 링크를 다시 받아 주세요.', { error: true });
      } else if (err.status === 401) {
        showGate('로그인이 필요합니다.');
      } else {
        showGate(err.message || '불러오지 못했어요.', { error: true, retry: true });
      }
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
  return { boot, showView, showCourse, afterEventsChanged, updateNotice, refresh };
})();
