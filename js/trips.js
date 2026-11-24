/* 여행 목록: 여행 고르기 / 새로 만들기 / 이름·기간 수정 / 삭제 (로그인한 소유자 전용) */
(function () {
  'use strict';
  const { $, esc, fmtDay, openModal, closeModal, toast } = TPUtil;
  const C = TPCore;
  const MODE = { olle: '🥾 올레길', general: '🧳 일반' };

  function nightsOf(t) { const n = C.dateRange(t.start_date, t.end_date).length - 1; return n + '박 ' + (n + 1) + '일'; }

  function listHTML(trips, curId) {
    if (!trips.length) return '<p class="muted">아직 여행이 없어요. 아래에서 첫 여행을 만들어 보세요.</p>';
    return '<ul class="trip-list">' + trips.map((t) =>
      '<li class="' + (t.id === curId ? 'cur' : '') + '"><button type="button" class="trip-pick" data-pick="' + esc(t.id) + '">' +
      '<b>' + esc(t.title) + '</b><small>' + esc(fmtDay(t.start_date)) + ' ~ ' + esc(fmtDay(t.end_date)) + ' · ' + nightsOf(t) +
      ' · ' + MODE[t.mode] + (t.id === curId ? ' · 보는 중' : '') + '</small></button>' +
      '<div class="row-actions"><button type="button" class="icon-btn" data-edit="' + esc(t.id) + '" title="수정">✎</button>' +
      '<button type="button" class="icon-btn danger" data-del="' + esc(t.id) + '" title="삭제">🗑</button></div></li>').join('') + '</ul>';
  }

  // 새 여행 / 수정 폼. t 가 있으면 수정.
  function formHTML(t) {
    const edit = !!t;
    return '<form id="tripForm" novalidate>' +
      '<h3>' + (edit ? '여행 수정' : '＋ 새 여행 만들기') + '</h3>' +
      '<label>여행 이름<input id="tfTitle" maxlength="100" value="' + esc(edit ? t.title : '') + '" placeholder="예: 2027 가을 부산 여행"></label>' +
      '<div class="two"><label>시작일<input type="date" id="tfStart" value="' + esc(edit ? t.start_date : '') + '"></label>' +
      '<label>종료일<input type="date" id="tfEnd" value="' + esc(edit ? t.end_date : '') + '"></label></div>' +
      (edit ? '' :
        '<label>여행 종류<select id="tfMode"><option value="general">🧳 일반 여행 (지도·장소 핀·캘린더)</option>' +
        '<option value="olle">🥾 제주 올레길 여행 (올레 코스 지도 포함)</option></select></label>' +
        '<div id="tfRegion"><div class="lbl">지도 시작 위치 <small class="muted">(도시·지역 이름으로 찾기, 건너뛰어도 돼요)</small></div>' +
        '<div class="place-sel" id="tfSel"></div>' +
        '<div class="copy-row"><input id="tfQ" type="search" enterkeyhint="search" placeholder="예: 부산, 도쿄, 파리"><button type="button" class="btn" id="tfGo">검색</button></div>' +
        '<ul id="tfRes" class="place-results inline" hidden></ul></div>') +
      '<div class="form-err" id="tfErr" hidden></div>' +
      '<div class="modal-actions">' + (edit ? '<button type="button" class="btn" id="tfCancel">취소</button>' : '') +
      '<button type="submit" class="btn primary" id="tfSave">' + (edit ? '저장' : '만들기') + '</button></div></form>';
  }

  function open(opts) {
    opts = opts || {};
    const cur = S.trip ? S.trip.id : null;
    const trips = TPData.tripList();
    const m = openModal('<h2>🧳 내 여행</h2><div id="tripBody"></div>', { wide: true });
    const body = $('#tripBody', m);
    let mode = 'list', editId = null, region = null;

    function render() {
      if (mode === 'list') {
        body.innerHTML = listHTML(TPData.tripList(), cur) + '<button type="button" class="btn primary block" id="tpNew">＋ 새 여행 만들기</button>' +
          (cur ? '<div class="modal-actions"><button type="button" class="btn" id="tpClose">닫기</button></div>' : '');
      } else {
        const t = editId ? TPData.tripList().find((x) => x.id === editId) : null;
        body.innerHTML = formHTML(t);
        wireForm(t);
      }
    }
    const showErr = (msg) => { const e = $('#tfErr', body); e.textContent = msg; e.hidden = !msg; };

    function wireForm(t) {
      const f = (id) => $('#' + id, body);
      if (!t) {
        region = null;
        const sync = () => { f('tfRegion').hidden = f('tfMode').value === 'olle'; };
        f('tfMode').addEventListener('change', sync); sync();
        const res = f('tfRes');
        let found = [];
        const doSearch = async () => {
          const q = f('tfQ').value.trim(); if (!q) return;
          f('tfGo').disabled = true;
          try {
            found = await TPPlaces.search(q, { world: true });
            res.innerHTML = found.length ? found.map((r, i) => '<li><button type="button" data-i="' + i + '"><b>' + esc(r.name) + '</b><small>' + esc(r.addr) + '</small></button></li>').join('') : '<li class="none">결과가 없어요. 다른 이름으로 찾아보세요.</li>';
            res.hidden = false;
          } catch (err) { showErr(err.message || '검색하지 못했어요'); }
          f('tfGo').disabled = false;
        };
        f('tfGo').addEventListener('click', doSearch);
        f('tfQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
        res.addEventListener('click', (e) => {
          const b = e.target.closest('button[data-i]'); if (!b) return;
          const r = found[Number(b.dataset.i)];
          region = { lat: r.lat, lng: r.lng, name: r.name };
          f('tfSel').innerHTML = '📍 <b>' + esc(r.name) + '</b> <small class="muted">' + esc(r.addr) + '</small> <button type="button" class="btn small" id="tfClear">지우기</button>';
          $('#tfClear', body).addEventListener('click', () => { region = null; f('tfSel').innerHTML = ''; });
          res.hidden = true;
          if (!f('tfTitle').value.trim()) f('tfTitle').placeholder = r.name + ' 여행';
        });
      } else f('tfCancel').addEventListener('click', () => { mode = 'list'; render(); });

      f('tripForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = f('tfTitle').value.trim() || (!t && region && f('tfMode').value === 'general' ? region.name + ' 여행' : '');
        const start = f('tfStart').value, end = f('tfEnd').value;
        if (!title) return showErr('여행 이름을 입력해 주세요.');
        if (!start || !end) return showErr('시작일과 종료일을 입력해 주세요.');
        if (end < start) return showErr('종료일이 시작일보다 빠릅니다.');
        if (C.dateRange(start, end).length > 60) return showErr('여행 기간은 60일까지 가능해요.');
        f('tfSave').disabled = true;
        try {
          if (t) {
            await TPData.patchTrip(t.id, { title, start_date: start, end_date: end });
            toast('수정했어요');
            closeModal();
            await App.switchTrip(t.id);
          } else {
            const md = f('tfMode').value;
            const created = await TPData.createTrip({
              title, start_date: start, end_date: end, mode: md,
              map_lat: md === 'general' && region ? region.lat : null, map_lng: md === 'general' && region ? region.lng : null,
              map_zoom: md === 'general' && region ? 11 : null
            });
            closeModal();
            await App.switchTrip(created.id);
            toast('새 여행을 만들었어요');
          }
        } catch (err) { showErr(err.message || '저장하지 못했어요'); f('tfSave').disabled = false; }
      });
    }

    body.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.pick) { closeModal(); if (b.dataset.pick !== cur) await App.switchTrip(b.dataset.pick); }
      else if (b.id === 'tpNew') { mode = 'form'; editId = null; render(); }
      else if (b.id === 'tpClose') closeModal();
      else if (b.dataset.edit) { mode = 'form'; editId = b.dataset.edit; render(); }
      else if (b.dataset.del) {
        const t = TPData.tripList().find((x) => x.id === b.dataset.del); if (!t) return;
        if (!confirm('"' + t.title + '" 여행을 삭제할까요?\n일정·⭐ 장소가 모두 지워지고, 이 여행의 공유 링크도 사라져요. 되돌릴 수 없어요.')) return;
        try {
          await TPData.deleteTrip(t.id);
          closeModal();
          toast('삭제했어요');
          await App.switchTrip(t.id === cur ? null : cur);
        } catch (err) { toast(err.message || '삭제하지 못했어요', 'err'); }
      }
    });
    if (opts.create || !trips.length) { mode = 'form'; editId = null; }
    render();
  }

  window.TPTrips = { open };
})();
