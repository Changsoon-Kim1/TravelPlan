/* 공용 도우미 */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const KIND = {
    olle: { icon: '🥾', label: '코스 걷기 (올레·한라산·오름)', color: '#16a34a' },
    flight: { icon: '✈️', label: '항공', color: '#2563eb' },
    stay: { icon: '🏨', label: '숙소', color: '#7c3aed' },
    meal: { icon: '🍽️', label: '식사', color: '#ea580c' },
    other: { icon: '📌', label: '기타', color: '#64748b' }
  };
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  function fmtDay(iso) { const p = TPCore.parseISO(iso); return p.m + '/' + p.d + '(' + WD[TPCore.weekday(iso)] + ')'; }
  function fmtTimeRange(ev) {
    if (!ev.start_time) return '종일';
    return ev.end_time ? ev.start_time + '~' + ev.end_time : ev.start_time;
  }
  // 지도 꼬리표용 짧은 표기: "4/14 15시", "4/14 10~15시", "4/14 10:30~15시", 여러 날이면 "4/14~4/15"
  function fmtTag(ev) {
    const md = (iso) => { const p = TPCore.parseISO(iso); return p.m + '/' + p.d; };
    if (ev.end_day && ev.end_day !== ev.day) return md(ev.day) + '~' + md(ev.end_day);
    if (!ev.start_time) return md(ev.day);
    const tok = (t) => { const [h, m] = t.split(':'); return m === '00' ? String(Number(h)) : Number(h) + ':' + m; };
    const parts = [ev.start_time, ev.end_time].filter(Boolean).map((t) => t.slice(0, 5));
    let txt = parts.map(tok).join('~');
    if (!/:/.test(txt.split('~').pop())) txt += '시';
    return md(ev.day) + ' ' + txt;
  }
  // 장소 일정 핀 꼬리표: 시간 빼고 날짜 + 이름. "4/14 신라호텔", 여러 날이면 "4/14~4/15 신라호텔"
  function fmtPinTag(ev) {
    const md = (iso) => { const p = TPCore.parseISO(iso); return p.m + '/' + p.d; };
    const d = ev.end_day && ev.end_day !== ev.day ? md(ev.day) + '~' + md(ev.end_day) : md(ev.day);
    return d + ' ' + ev.title;
  }
  function todayISO() {
    const d = new Date();
    return TPCore.toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  let toastTimer = null;
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'show ' + (kind || 'ok');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, kind === 'err' ? 4500 : 2400);
  }

  // ---- 모달 ----
  let modalOnClose = null;
  function openModal(html, opts) {
    closeModal();
    modalOnClose = (opts && opts.onClose) || null;
    const root = $('#modalRoot');
    root.innerHTML = '<div class="modal-back"><div class="modal' + ((opts && opts.wide) ? ' wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div></div>';
    const back = $('.modal-back', root);
    back.addEventListener('mousedown', (e) => { if (e.target === back) closeModal(); });
    return $('.modal', root);
  }
  function closeModal() {
    const root = $('#modalRoot');
    if (!root.firstChild) return;
    root.innerHTML = '';
    if (modalOnClose) { const f = modalOnClose; modalOnClose = null; f(); }
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // ---- 외부 링크 (지도/검색) ----
  const enc = encodeURIComponent;
  const links = {
    naverMap: (q) => 'https://map.naver.com/p/search/' + enc(q),
    kakaoMap: (q) => 'https://map.kakao.com/?q=' + enc(q),
    googleMap: (q) => 'https://www.google.com/maps/search/?api=1&query=' + enc(q),
    naverImage: (q) => 'https://search.naver.com/search.naver?where=image&query=' + enc(q),
    googleImage: (q) => 'https://www.google.com/search?tbm=isch&q=' + enc(q),
    commons: (q) => 'https://commons.wikimedia.org/w/index.php?search=' + enc(q) + '&ns6=1&ns14=1',
    naverBlog: (q) => 'https://search.naver.com/search.naver?where=blog&query=' + enc(q),
    olleHome: 'https://www.jejuolle.org/',
    jejuBus: 'https://bus.jeju.go.kr/'
  };

  window.TPUtil = { $, $$, esc, KIND, WD, fmtDay, fmtTimeRange, fmtTag, fmtPinTag, todayISO, toast, openModal, closeModal, links };
})();
