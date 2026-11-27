/* 대화상자: 일정 입력/수정, 삭제, 공유, 코스 GPX 올리기, 로그인 */
(function () {
  'use strict';
  const { $, $$, esc, KIND, fmtDay, openModal, closeModal, toast } = TPUtil;
  const C = TPCore;
  const byId = (id) => window.OLLE_COURSES.find((c) => c.id === id);

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* 아래 대체 방식 */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  // ---------- 일정 추가/수정 ----------
  function suggestedDay() {
    const t = S.trip, days = C.dateRange(t.start_date, t.end_date);
    const inner = days.slice(1, -1); // 첫날(도착)·마지막날(출발)은 마지막 후보
    const taken = new Set(S.events.filter((e) => e.course_id).map((e) => e.day));
    return inner.find((d) => !taken.has(d)) || days.find((d) => !taken.has(d)) || t.start_date;
  }

  function openEventModal(opts) {
    opts = opts || {};
    if (!TPData.canEdit()) { toast('읽기 전용 링크라서 수정할 수 없어요', 'err'); return; }
    const editing = opts.event || null;
    const d = Object.assign(
      { kind: 'other', title: '', day: S.selectedDay || S.trip.start_date, end_day: '', start_time: '', end_time: '', note: '', course_id: '', place: '', lat: null, lng: null },
      opts.defaults || {}, editing || {});
    const allDay = !d.start_time;
    const generalTrip = S.trip && S.trip.mode === 'general';
    const kindOpts = Object.keys(KIND).filter((k) => !(generalTrip && k === 'olle' && d.kind !== 'olle')).map((k) => '<option value="' + k + '"' + (k === d.kind ? ' selected' : '') + '>' + KIND[k].icon + ' ' + KIND[k].label + '</option>').join('');
    const courseOpts = '<option value="">(선택 안 함)</option>' + TPCourses.optionsHTML(d.course_id, true);

    const m = openModal(
      '<h2>' + (editing ? '일정 수정' : '일정 추가') + '</h2>' +
      '<form id="evForm" novalidate>' +
      '<label>종류<select id="fKind">' + kindOpts + '</select></label>' +
      '<label id="rowCourse" ' + (d.kind === 'olle' ? '' : 'hidden') + '>코스 <small class="muted">(올레·한라산·오름)</small><select id="fCourse">' + courseOpts + '</select></label>' +
      '<div id="rowPlace" ' + (d.kind === 'olle' ? 'hidden' : '') + '><div class="lbl">장소 <small class="muted">(지도에 핀·날짜로 표시)</small></div>' +
      '<div class="place-sel" id="pSel"></div>' +
      '<div class="copy-row"><input id="pQ" type="search" enterkeyhint="search" placeholder="장소 검색 (예: 호텔·식당 이름)"><button type="button" class="btn" id="pGo">검색</button></div>' +
      '<ul id="pRes" class="place-results inline" hidden></ul></div>' +
      '<label>제목<input id="fTitle" maxlength="200" value="' + esc(d.title) + '" placeholder="예: 저녁 식사, 렌터카 반납"></label>' +
      '<div class="two"><label>날짜<input type="date" id="fDay" value="' + esc(d.day) + '"></label>' +
      '<label>마지막 날 <small class="muted">(여러 날일 때)</small><input type="date" id="fEndDay" value="' + esc(d.end_day || '') + '"></label></div>' +
      '<label class="check"><input type="checkbox" id="fAllDay"' + (allDay ? ' checked' : '') + '> 시간 없이 하루 종일</label>' +
      '<div class="two"><label>시작<input type="time" id="fStart" value="' + esc(d.start_time || '') + '"' + (allDay ? ' disabled' : '') + '></label>' +
      '<label>종료<input type="time" id="fEnd" value="' + esc(d.end_time || '') + '"' + (allDay ? ' disabled' : '') + '></label></div>' +
      '<label>메모<textarea id="fNote" rows="2" maxlength="2000">' + esc(d.note || '') + '</textarea></label>' +
      '<p class="form-err" id="fErr" role="alert" hidden></p>' +
      '<div class="modal-actions"><button type="button" class="btn" id="fCancel">취소</button><button type="submit" class="btn primary" id="fSave">저장</button></div>' +
      '</form>');

    const f = (id) => $('#' + id, m);
    let endTouched = !!d.end_time;
    let autoTitle = d.title && d.course_id ? d.title : '';
    const showErr = (msg) => { const e = f('fErr'); e.textContent = msg; e.hidden = !msg; };

    let place = d.place || '', lat = d.lat == null ? null : d.lat, lng = d.lng == null ? null : d.lng, found = [];
    function renderPlace() {
      f('pSel').innerHTML = lat == null ? '<span class="muted sm">선택 안 함</span>'
        : '📍 <b>' + esc(place || '선택한 위치') + '</b> <button type="button" class="btn small" id="pClear">지우기</button>';
      const c = f('pClear'); if (c) c.addEventListener('click', () => { place = ''; lat = lng = null; renderPlace(); });
    }
    renderPlace();
    async function doPlaceSearch() {
      const q = f('pQ').value.trim(); if (!q) return;
      const go = f('pGo'); go.disabled = true; go.textContent = '…';
      try {
        found = await TPPlaces.search(q);
        f('pRes').innerHTML = found.length ? found.map((r, i) => '<li><button type="button" data-i="' + i + '"><b>' + esc(r.name) + '</b><small>' + esc(r.addr) + '</small></button></li>').join('')
          : '<li class="none">검색 결과가 없어요. 이름을 줄여 보세요. (지도 화면에서 길게 눌러 위치를 고를 수도 있어요)</li>';
        f('pRes').hidden = false;
      } catch (err) { showErr(err.message || '검색하지 못했어요'); }
      go.disabled = false; go.textContent = '검색';
    }
    f('pGo').addEventListener('click', doPlaceSearch);
    f('pQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doPlaceSearch(); } });
    f('pRes').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]'); if (!b) return;
      const r = found[Number(b.dataset.i)];
      place = r.name; lat = r.lat; lng = r.lng; renderPlace();
      if (!f('fTitle').value.trim()) f('fTitle').value = r.name;
      f('pRes').hidden = true; f('pQ').value = '';
    });

    function syncCourseRow() { const olle = f('fKind').value === 'olle'; f('rowCourse').hidden = !olle; f('rowPlace').hidden = olle; }
    function autoEnd() {
      const c = byId(f('fCourse').value);
      if (!c || endTouched || f('fAllDay').checked || !f('fStart').value) return;
      f('fEnd').value = C.defaultEnd(f('fStart').value, c.maxHours) || '';
    }
    f('fKind').addEventListener('change', syncCourseRow);
    f('fCourse').addEventListener('change', () => {
      const c = byId(f('fCourse').value);
      if (!c) return;
      f('fKind').value = 'olle'; syncCourseRow();
      if (!f('fTitle').value.trim() || f('fTitle').value === autoTitle) { autoTitle = TPCourses.titleOf(c); f('fTitle').value = autoTitle; }
      if (!f('fAllDay').checked && !f('fStart').value) { f('fStart').value = '10:00'; }
      autoEnd();
    });
    f('fAllDay').addEventListener('change', () => {
      const off = f('fAllDay').checked;
      f('fStart').disabled = f('fEnd').disabled = off;
      if (off) { f('fStart').value = ''; f('fEnd').value = ''; }
      else if (!f('fStart').value) { f('fStart').value = '10:00'; autoEnd(); }
    });
    f('fStart').addEventListener('change', autoEnd);
    f('fEnd').addEventListener('input', () => { endTouched = true; });
    f('fCancel').addEventListener('click', closeModal);

    $('#evForm', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      const allDayNow = f('fAllDay').checked;
      const ev = {
        id: editing ? editing.id : null,
        kind: f('fKind').value, course_id: f('fKind').value === 'olle' ? (f('fCourse').value || null) : null,
        title: f('fTitle').value.trim(), day: f('fDay').value, end_day: f('fEndDay').value || null,
        start_time: allDayNow ? null : (f('fStart').value || null), end_time: allDayNow ? null : (f('fEnd').value || null),
        note: f('fNote').value.trim(),
        place: f('fKind').value === 'olle' ? null : (place || null), lat: f('fKind').value === 'olle' ? null : lat, lng: f('fKind').value === 'olle' ? null : lng
      };
      if (!ev.title) return showErr('제목을 입력해 주세요.');
      if (!ev.day) return showErr('날짜를 선택해 주세요.');
      if (ev.end_day && ev.end_day < ev.day) return showErr('마지막 날이 시작 날짜보다 빠릅니다.');
      if (!allDayNow && !ev.start_time) return showErr('시작 시간을 입력하거나 "하루 종일"을 선택해 주세요.');
      const multiDay = ev.end_day && ev.end_day > ev.day; // 여러 날이면 시작은 첫날, 종료는 마지막 날 시각이라 역전 가능
      if (!multiDay && ev.start_time && ev.end_time && C.toMin(ev.end_time) <= C.toMin(ev.start_time)) return showErr('종료 시간이 시작 시간보다 늦어야 해요.');
      const clash = C.findOverlaps(ev, S.events, ev.id);
      if (clash.length && !confirm('같은 시간대에 이미 일정이 있어요:\n' + clash.map((x) => '· ' + x.title + ' (' + (x.start_time || '') + (x.end_time ? '~' + x.end_time : '') + ')').join('\n') + '\n\n그래도 저장할까요?')) return;
      showErr('');
      const btn = f('fSave'); btn.disabled = true; btn.textContent = '저장 중…';
      try {
        const saved = await TPData.saveEvent(ev);
        const i = S.events.findIndex((x) => x.id === saved.id);
        if (i >= 0) S.events[i] = saved; else S.events.push(saved);
        S.selectedDay = saved.day;
        closeModal();
        App.afterEventsChanged();
        toast(editing ? '일정을 수정했어요' : '일정에 추가했어요');
      } catch (err) {
        btn.disabled = false; btn.textContent = '저장';
        showErr(err.message || '저장하지 못했어요');
      }
    });
    setTimeout(() => { const t = f('fTitle'); if (t && !t.value) t.focus(); }, 30);
  }

  function openCourseEventModal(c) {
    openEventModal({
      defaults: {
        kind: 'olle', course_id: c.id, title: TPCourses.titleOf(c),
        day: suggestedDay(), start_time: '10:00', end_time: C.defaultEnd('10:00', c.maxHours)
      }
    });
  }

  async function deleteEvent(id) {
    const ev = S.events.find((e) => e.id === id);
    if (!ev) return;
    if (!confirm('"' + ev.title + '" 일정을 삭제할까요?')) return;
    try {
      await TPData.deleteEvent(id);
      S.events = S.events.filter((e) => e.id !== id);
      App.afterEventsChanged();
      toast('일정을 삭제했어요');
    } catch (err) { toast(err.message || '삭제하지 못했어요', 'err'); }
  }

  // ---------- 공유 ----------
  function openShareModal() {
    const t = S.trip;
    const m = openModal(
      '<h2>🔗 배우자와 공유</h2>' +
      '<p class="muted">아래 링크만 있으면 로그인 없이 바로 접속할 수 있어요. 링크를 아는 사람은 누구나 볼 수 있으니 카톡·문자로 배우자에게만 보내 주세요.</p>' +
      '<div class="copy-row"><input id="shLink" readonly value="' + esc(TPData.shareLink()) + '"><button class="btn primary" id="shCopy">복사</button></div>' +
      (navigator.share ? '<button class="btn block" id="shNative">📤 카톡·문자 등으로 보내기</button>' : '') +
      '<label class="check"><input type="checkbox" id="shEnabled"' + (t.share_enabled ? ' checked' : '') + '> 링크로 접속 허용</label>' +
      '<label class="check"><input type="checkbox" id="shEdit"' + (t.share_can_edit ? ' checked' : '') + '> 링크로 일정 추가·수정·삭제 허용 <small class="muted">(끄면 보기 전용)</small></label>' +
      '<button class="btn block danger-outline" id="shRotate">🔄 새 링크 만들기 (이전 링크는 바로 막힘)</button>' +
      '<div class="modal-actions"><button class="btn" id="shClose">닫기</button></div>');
    $('#shClose', m).addEventListener('click', closeModal);
    $('#shCopy', m).addEventListener('click', async () => toast((await copyText($('#shLink', m).value)) ? '링크를 복사했어요' : '복사하지 못했어요. 직접 선택해서 복사해 주세요', 'ok'));
    const nat = $('#shNative', m);
    if (nat) nat.addEventListener('click', () => navigator.share({ title: S.trip.title, text: '제주 여행 계획', url: TPData.shareLink() }).catch(() => {}));
    $('#shLink', m).addEventListener('focus', (e) => e.target.select());
    const patch = async (obj, msg) => {
      try { await TPData.updateTrip(obj); S.trip = TPData.trip(); toast(msg); } catch (err) { toast(err.message, 'err'); }
    };
    $('#shEnabled', m).addEventListener('change', (e) => patch({ share_enabled: e.target.checked }, e.target.checked ? '링크 접속을 허용했어요' : '링크 접속을 껐어요'));
    $('#shEdit', m).addEventListener('change', (e) => patch({ share_can_edit: e.target.checked }, e.target.checked ? '링크로 수정할 수 있어요' : '링크는 보기 전용이에요'));
    $('#shRotate', m).addEventListener('click', async () => {
      if (!confirm('새 링크를 만들면 지금까지 보낸 링크는 더 이상 열리지 않아요. 계속할까요?')) return;
      try { await TPData.rotateShareToken(); S.trip = TPData.trip(); $('#shLink', m).value = TPData.shareLink(); toast('새 링크를 만들었어요. 배우자에게 다시 보내 주세요'); }
      catch (err) { toast(err.message, 'err'); }
    });
  }

  // ---------- 코스 GPX 올리기 (올레 + 한라산·오름 등 새 코스) ----------
  function openGpxModal() {
    const CATS = TPCourses.CATS;
    const m = openModal(
      '<h2>🗺 코스 GPX 올리기</h2>' +
      '<p class="muted">코스별 GPX 파일을 고르세요(여러 개 가능). <b>올레</b>는 파일 이름에 코스 번호(예: 10코스, 7-1)가 있으면 자동으로 맞춰요. ' +
      '<b>한라산 탐방로·오름</b>은 "새 한라산 코스 / 새 오름"을 고르고 이름을 적으면 새 코스로 추가돼요(파일 이름에 성판악·관음사·○○오름 등이 있으면 자동). 배우자도 같이 볼 수 있어요.</p>' +
      '<input type="file" id="gpxFiles" accept=".gpx,application/gpx+xml,text/xml,application/xml" multiple>' +
      '<datalist id="hallaNames">' + TPCourses.HALLA_TRAILS.map((t) => '<option value="' + esc(t) + ' 탐방로">').join('') + '</datalist>' +
      '<div id="gpxRows" class="gpx-rows"></div>' +
      '<p class="form-err" id="gpxErr" role="alert" hidden></p>' +
      '<div class="modal-actions"><button class="btn" id="gpxClose">닫기</button><button class="btn primary" id="gpxSave" disabled>선택한 경로 저장</button></div>' +
      '<h3>등록된 경로 <small id="gpxCount"></small></h3><div id="gpxDone"></div>', { wide: true });
    const rowsEl = $('#gpxRows', m), saveBtn = $('#gpxSave', m);
    let parsed = []; // { name, path, km, courseId, newCat, newName }
    const baseIds = TPCourses.base().map((c) => c.id);
    // 올레 코스를 고를 때 파일 위치가 그 코스(올린 경로 또는 임시 대략 경로)와 4km 넘게 떨어져 있으면 다른 코스 파일일 가능성이 큼
    function offsetKm(id, path) {
      const c = byId(id); if (!c || c.extra) return 0;
      let ref = S.routes[id] && S.routes[id].length > 1 ? S.routes[id] : null;
      if (!ref && window.APPROX_COURSES && window.APPROX_COURSES[id]) { try { ref = C.approxPath(window.APPROX_COURSES[id], window.APPROX_ANCHORS); } catch (e) { ref = null; } }
      if (!ref || ref.length < 2) return 0;
      const f = [path[0], path[path.length - 1]], e = [ref[0], ref[ref.length - 1]];
      return Math.min.apply(null, [[0, 0], [0, 1], [1, 0], [1, 1]].map((k) => C.haversineKm(f[k[0]], e[k[1]])));
    }

    function doneRow(c) {
      const id = c.id, label = c.extra ? c.icon + ' ' + c.name : c.code + ' ' + c.name;
      return '<div class="gpx-done"><span><span class="dot" style="background:' + S.colors[id] + '"></span>' + esc(label) +
        ' <small class="muted">' + S.routes[id].length + '점 · ' + C.pathLengthKm(S.routes[id]).toFixed(1) + 'km</small></span>' +
        '<button class="icon-btn danger" data-rm="' + id + '" title="이 경로 삭제">🗑</button></div>';
    }
    function renderDone() {
      const olle = TPCourses.base().filter((c) => S.routes[c.id] && S.routes[c.id].length > 1);
      const ex = TPCourses.extras();
      $('#gpxCount', m).textContent = '(올레 ' + olle.length + '/' + baseIds.length + (ex.length ? ' · 한라산·오름 ' + ex.length : '') + ')';
      $('#gpxDone', m).innerHTML = (ex.length ? '<div class="vis-t">⛰ 한라산 · 오름 · 기타</div>' + ex.map(doneRow).join('') : '') +
        (olle.length ? '<div class="vis-t">🥾 제주올레</div>' + olle.map(doneRow).join('') : '') +
        (!olle.length && !ex.length ? '<p class="muted sm">아직 올린 경로가 없어요. (올레는 지도에 임시 대략 경로가 표시됩니다)</p>' : '');
    }
    function rowSelect(p, i) {
      const sel = p.newCat ? '__new_' + p.newCat : (p.courseId || '');
      const news = Object.keys(CATS).map((k) => '<option value="__new_' + k + '"' + (sel === '__new_' + k ? ' selected' : '') + '>➕ 새 ' + CATS[k].label + ' 코스로 추가</option>').join('');
      return '<select data-i="' + i + '"><option value="">(건너뜀)</option><optgroup label="새 코스">' + news + '</optgroup>' +
        TPCourses.optionsHTML(sel, false) + '</select>';
    }
    function renderRows() {
      rowsEl.innerHTML = parsed.map((p, i) => {
        const c = p.courseId && byId(p.courseId);
        const off = c ? offsetKm(c.id, p.path) : 0;
        const warn = (c && !c.extra && Math.abs(p.km - c.distance) / c.distance > 0.3 ? '<div class="warn-text">⚠ 파일 길이 ' + p.km.toFixed(1) + 'km, 코스 ' + c.distance.toFixed(1) + 'km — 맞는 코스인지 확인하세요</div>' : '') +
          (off > 4 ? '<div class="warn-text">⚠ 이 파일은 ' + esc(c.code) + ' 위치에서 약 ' + Math.round(off) + 'km 떨어져 있어요 — 한라산·오름 파일이면 "새 코스로 추가"를 고르세요</div>' : '');
        const nameIn = p.newCat ? '<input type="text" class="gpx-newname" data-n="' + i + '" maxlength="60" placeholder="코스 이름 (예: ' + (p.newCat === 'halla' ? '성판악 탐방로' : p.newCat === 'oreum' ? '새별오름' : '사려니숲길') + ')"' +
          (p.newCat === 'halla' ? ' list="hallaNames"' : '') + ' value="' + esc(p.newName || '') + '">' : '';
        return '<div class="gpx-row"><div class="gpx-name">' + esc(p.name) + ' <small class="muted">' + p.path.length + '점 · ' + p.km.toFixed(1) + 'km</small>' + warn + '</div>' +
          rowSelect(p, i) + nameIn + '</div>';
      }).join('');
      $$('select', rowsEl).forEach((s) => s.addEventListener('change', () => {
        const p = parsed[Number(s.dataset.i)], v = s.value;
        if (v.indexOf('__new_') === 0) { p.newCat = v.slice(6); p.courseId = null; if (!p.newName) p.newName = (TPCourses.guess(p.name) || {}).name || ''; }
        else { p.newCat = null; p.courseId = v || null; }
        renderRows();
      }));
      $$('.gpx-newname', rowsEl).forEach((inp) => inp.addEventListener('input', () => { parsed[Number(inp.dataset.n)].newName = inp.value; updateSave(); }));
      updateSave();
    }
    const ready = (p) => p.courseId || (p.newCat && (p.newName || '').trim());
    function updateSave() { saveBtn.disabled = !parsed.some(ready); }

    $('#gpxFiles', m).addEventListener('change', async (e) => {
      const err = $('#gpxErr', m); err.hidden = true;
      parsed = [];
      for (const file of Array.from(e.target.files)) {
        try {
          const path = C.parseGpx(await file.text());
          if (path.length < 2) { err.textContent = file.name + ': 경로 점(trkpt)을 찾지 못해 건너뛰었어요.'; err.hidden = false; continue; }
          const p = { name: file.name, path, km: C.pathLengthKm(path), courseId: null, newCat: null, newName: '' };
          // 파일 이름에 올레/코스가 없고 한라산·오름 이름이 있으면 번호(날짜 등)보다 그 이름을 먼저 본다
          const olleWord = /올레|olle|코스/i.test(file.name), g0 = TPCourses.guess(file.name);
          if (!(g0 && !olleWord)) p.courseId = C.guessCourseId(file.name, baseIds);
          if (p.courseId && offsetKm(p.courseId, path) > 4) p.courseId = null; // 위치가 맞지 않으면 자동 선택하지 않음
          if (!p.courseId) {
            const g = TPCourses.guess(file.name);
            if (g) {
              const same = TPCourses.extras().find((c) => c.category === g.category && c.name === g.name);
              if (same) p.courseId = same.id; else { p.newCat = g.category; p.newName = g.name; }
            }
          }
          parsed.push(p);
        } catch (x) { err.textContent = file.name + ': 파일을 읽지 못했어요.'; err.hidden = false; }
      }
      renderRows();
    });
    saveBtn.addEventListener('click', async () => {
      const map = {}, meta = {}, dup = [];
      parsed.filter(ready).forEach((p) => {
        let id = p.courseId;
        if (p.newCat) { id = TPCourses.newId(p.newCat); meta[id] = { name: p.newName.trim().slice(0, 60), category: p.newCat }; }
        else { const c = byId(id); if (c && c.extra) meta[id] = { name: c.name, category: c.category }; }
        if (map[id]) dup.push(id);
        map[id] = C.compactPath(p.path, 1500);
      });
      const far = parsed.filter((p) => p.courseId && offsetKm(p.courseId, p.path) > 4);
      if (far.length && !confirm('위치가 맞지 않는 올레 코스에 저장하려는 파일이 있어요:\n' + far.map((p) => p.name + ' → ' + TPCourses.titleOf(byId(p.courseId))).join('\n') + '\n그래도 저장할까요? (그 코스의 기존 경로가 덮어써져요)')) return;
      if (dup.length && !confirm('같은 코스(' + dup.map((id) => TPCourses.titleOf(byId(id))).join(', ') + ')에 파일이 여러 개 선택됐어요. 마지막 파일만 저장할까요?')) return;
      saveBtn.disabled = true; saveBtn.textContent = '저장 중…';
      try {
        await TPData.saveRoutes(map, meta);
        Object.assign(S.routes, map);
        Object.keys(meta).forEach((id) => {
          S.extras = S.extras.filter((x) => x.id !== id).concat([{ id, name: meta[id].name, category: meta[id].category }]);
        });
        App.coursesChanged();
        parsed = []; rowsEl.innerHTML = ''; $('#gpxFiles', m).value = '';
        renderDone();
        toast(Object.keys(map).length + '개 코스 경로를 저장했어요');
      } catch (err) { $('#gpxErr', m).textContent = err.message; $('#gpxErr', m).hidden = false; }
      saveBtn.textContent = '선택한 경로 저장'; updateSave();
    });
    $('#gpxDone', m).addEventListener('click', async (e) => {
      const b = e.target.closest('[data-rm]');
      if (!b) return;
      const c = byId(b.dataset.rm);
      const used = S.events.filter((x) => x.course_id === c.id).length;
      const msg = c.extra
        ? TPCourses.titleOf(c) + ' 코스를 삭제할까요? 코스 목록과 지도에서 사라져요.' + (used ? ' (이 코스로 잡은 일정 ' + used + '개는 코스 연결 없이 남아요)' : '')
        : c.code + ' 경로를 삭제할까요? (임시 대략 경로로 돌아가요)';
      if (!confirm(msg)) return;
      try {
        await TPData.deleteRoute(c.id);
        delete S.routes[c.id];
        S.extras = S.extras.filter((x) => x.id !== c.id);
        if (TPPanel.current() === c.id && c.extra) TPPanel.close();
        App.coursesChanged();
        renderDone();
      } catch (err) { toast(err.message, 'err'); }
    });
    $('#gpxClose', m).addEventListener('click', closeModal);
    renderDone();
  }

  // ---------- 로그인 ----------
  function openLoginModal() {
    const m = openModal(
      '<h2>로그인</h2><p class="muted">GPX Tracker와 같은 이메일·비밀번호를 쓰면 돼요.</p>' +
      '<form id="loginForm"><label>이메일<input type="email" id="lgEmail" autocomplete="username" required></label>' +
      '<label>비밀번호<input type="password" id="lgPw" autocomplete="current-password" required></label>' +
      '<p class="form-err" id="lgErr" role="alert" hidden></p>' +
      '<div class="modal-actions"><button type="button" class="btn" id="lgCancel">취소</button><button class="btn primary" id="lgGo">로그인</button></div></form>');
    $('#lgCancel', m).addEventListener('click', closeModal);
    $('#loginForm', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#lgGo', m); btn.disabled = true; btn.textContent = '로그인 중…';
      try { await TPData.login($('#lgEmail', m).value.trim(), $('#lgPw', m).value); closeModal(); App.boot(); }
      catch (err) { btn.disabled = false; btn.textContent = '로그인'; const el = $('#lgErr', m); el.textContent = err.message; el.hidden = false; }
    });
    setTimeout(() => $('#lgEmail', m).focus(), 30);
  }

  window.TPDialogs = { openEventModal, openCourseEventModal, deleteEvent, openShareModal, openGpxModal, openLoginModal, copyText };
})();
