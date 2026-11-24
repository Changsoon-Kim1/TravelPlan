/* 지도: Leaflet + OpenStreetMap 계열(키 불필요). 코스를 색으로 구분해 그린다. */
(function () {
  'use strict';
  const { esc } = TPUtil;

  let map = null;
  let ready = false;
  let pinLayer = null, searchLayer = null, favLayer = null;
  const favMarkers = {};
  const pinMarkers = {};      // eventId -> marker
  let onPickPlace = () => {};  // 지도를 길게 눌렀을 때
  let colors = {};
  let routes = {};            // 올린 GPX 경로 { courseId: [[lat,lon],...] }
  let selectedId = null;
  let scheduled = new Set();
  let filterFn = () => true;
  let onSelect = () => {};
  const groups = {};          // courseId -> { group, line, hit, badge, exact }
  const courseById = {};

  function pathFor(c) {
    if (routes[c.id] && routes[c.id].length > 1) return { path: routes[c.id], exact: true };
    return { path: TPCore.approxPath(window.APPROX_COURSES[c.id], window.APPROX_ANCHORS), exact: false };
  }
  function labelText(c) {
    return c.id.replace(/^0/, '') + (window.OLLE_SPRING_IDS.includes(c.id) ? '🌸' : '');
  }
  // 내 일정에 든 코스는 굵고 진하게, 아닌 코스는 가늘고 연하게 (선택하면 둘 다 잠시 강조)
  function lineStyle(c, exact) {
    const sel = selectedId === c.id, sch = scheduled.has(c.id);
    const weight = sch ? (sel ? 7 : 5) : (sel ? 5 : 3);
    const opacity = (sch || sel) ? 1 : 0.3;
    return { color: colors[c.id], weight, opacity, dashArray: exact ? null : (sch ? '12 8' : '8 8'), lineCap: 'round', lineJoin: 'round' };
  }
  // 선 아래에 깔리는 흰 테두리: 일정 코스는 두껍게, 나머지는 얇고 연하게
  function casingStyle(c) {
    const sel = selectedId === c.id, sch = scheduled.has(c.id);
    const weight = sch ? (sel ? 10 : 8) : (sel ? 8 : 5);
    return { color: '#fff', weight, opacity: (sch || sel) ? 0.95 : 0.25, lineCap: 'round', lineJoin: 'round', interactive: false };
  }
  // 일정 코스 꼬리표: "4/12(월) 10:00~15:00" (같은 코스를 여러 번 잡았으면 가장 이른 일정 + 건수)
  function scheduleTag(c) {
    const list = scheduled.get ? scheduled.get(c.id) : null;
    if (!list || !list.length) return '';
    const ev = list[0];
    let t = TPUtil.fmtTag(ev);
    if (list.length > 1) t += ' +' + (list.length - 1);
    return '<span class="course-tag">' + esc(t) + '</span>';
  }
  function badgeIcon(c) {
    const sel = selectedId === c.id, sch = scheduled.has(c.id);
    return L.divIcon({
      className: 'course-badge-wrap',
      html: '<div class="course-badge' + (sel ? ' sel' : '') + (sch ? ' sch' : '') + '" style="background:' + colors[c.id] + ';color:#fff">' +
        esc(labelText(c)) + (sch ? '<i>✓</i>' : '') + (sch ? scheduleTag(c).replace('<span', '<span style="color:' + colors[c.id] + ';border-color:' + colors[c.id] + '"') : '') + '</div>',
      iconSize: null,
      zIndexOffset: 0
    });
  }

  function drawCourse(c) {
    if (groups[c.id]) { groups[c.id].group.remove(); delete groups[c.id]; }
    const { path, exact } = pathFor(c);
    const pick = () => onSelect(c.id);
    const hit = L.polyline(path, { color: '#000', weight: 22, opacity: 0, bubblingMouseEvents: false }).on('click', pick);
    const casing = L.polyline(path, casingStyle(c)).on('click', pick);
    const line = L.polyline(path, lineStyle(c, exact)).on('click', pick);
    const mid = path[Math.floor((path.length - 1) / 2)];
    const badge = L.marker(mid, { icon: badgeIcon(c), keyboard: false, riseOnHover: true }).on('click', pick);
    const group = L.layerGroup([hit, casing, line, badge]);
    groups[c.id] = { group, line, casing, hit, badge, exact };
    if (filterFn(c)) group.addTo(map);
  }

  function restyle(id) {
    const g = groups[id], c = courseById[id];
    if (!g || !c) return;
    g.casing.setStyle(casingStyle(c));
    g.line.setStyle(lineStyle(c, g.exact));
    g.badge.setIcon(badgeIcon(c));
    if (selectedId === id || scheduled.has(id)) { g.casing.bringToFront(); g.line.bringToFront(); }
    g.badge.setZIndexOffset(scheduled.has(id) ? 500 : (selectedId === id ? 1000 : 0));
  }

  const KIND = TPUtil.KIND;
  // 네이버 지도에서 이 장소 열기 (검색 링크; 휴대폰에선 네이버 지도 앱으로 이어질 수 있음)
  function naverLink(name) {
    const q = String(name || '').trim();
    if (!q) return '';
    return '<a class="btn small naver" target="_blank" rel="noopener" href="' + esc(TPUtil.links.naverMap(/제주/.test(q) ? q : '제주 ' + q)) + '">🗺 네이버 지도</a>';
  }
  function pinPopupHtml(e) {
    const canEdit = TPData.canEdit();
    return '<div class="pin-pop"><b>' + esc((KIND[e.kind] || KIND.other).icon + ' ' + e.title) + '</b>' +
      '<div class="muted sm">' + esc(TPUtil.fmtDay(e.day) + (e.end_day && e.end_day !== e.day ? '~' + TPUtil.fmtDay(e.end_day) : '') + ' ' + (e.end_day && e.end_day !== e.day ? '' : TPUtil.fmtTimeRange(e))) + '</div>' +
      (e.place && e.place !== e.title ? '<div class="muted sm">📍 ' + esc(e.place) + '</div>' : '') +
      '<div class="pin-act">' + naverLink(e.place || e.title) + '</div>' +
      (canEdit ? '<div class="pin-act"><button class="btn small" data-pin-edit="' + esc(e.id) + '">수정</button><button class="btn small danger" data-pin-del="' + esc(e.id) + '">삭제</button></div>' : '') + '</div>';
  }
  function placePopupHtml(pl) {
    return '<div class="pin-pop"><b>⭐ ' + esc(pl.name) + '</b>' + (pl.addr ? '<div class="muted sm">' + esc(pl.addr) + '</div>' : '') +
      '<div class="pin-act">' + naverLink(pl.name) + '</div>' +
      (TPData.canEdit() ? '<div class="pin-act"><button class="btn small primary" data-place-add="' + esc(pl.id) + '">📅 일정에 추가</button>' +
        '<button class="btn small danger" data-place-del="' + esc(pl.id) + '">표시 해제</button></div>' : '') + '</div>';
  }
  let foundPlace = null;
  function foundPopupHtml(p) {
    foundPlace = p;
    return '<div class="pin-pop"><b>' + esc(p.name) + '</b>' + (p.addr ? '<div class="muted sm">' + esc(p.addr) + '</div>' : '') +
      '<div class="pin-act">' + naverLink(p.name) + '</div>' +
      (TPData.canEdit() ? '<div class="pin-act"><button class="btn small" data-found-mark="1">⭐ 지도에 표시</button><button class="btn small primary" data-found-add="1">📅 일정에 추가</button></div>' : '') + '</div>';
  }

  function addBaseLayers() {
    const osmAttr = '© OpenStreetMap contributors';
    document.addEventListener('click', (ev) => {
      const b = ev.target.closest && ev.target.closest('.pin-pop button');
      if (!b) return;
      if (b.dataset.pinEdit) { const e = S.events.find((x) => x.id === b.dataset.pinEdit); map.closePopup(); if (e) TPDialogs.openEventModal({ event: e }); }
      else if (b.dataset.pinDel) { map.closePopup(); TPDialogs.deleteEvent(b.dataset.pinDel); }
      else if (b.dataset.foundMark && foundPlace) { const p = foundPlace; map.closePopup(); App.markPlace(p); }
      else if (b.dataset.placeDel) { map.closePopup(); App.unmarkPlace(b.dataset.placeDel); }
      else if (b.dataset.placeAdd) {
        const pl = S.places.find((x) => x.id === b.dataset.placeAdd); map.closePopup();
        if (pl) TPDialogs.openEventModal({ defaults: { kind: 'other', title: pl.name, place: pl.name, lat: pl.lat, lng: pl.lng } });
      }
      else if (b.dataset.foundAdd && foundPlace) {
        const p = foundPlace; map.closePopup(); searchLayer.clearLayers();
        TPDialogs.openEventModal({ defaults: { kind: 'other', title: p.name, place: p.name, lat: p.lat, lng: p.lng } });
      }
    });
    const bases = {
      'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: osmAttr }),
      'OpenStreetMap (대체 서버)': L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', { maxNativeZoom: 18, maxZoom: 19, attribution: osmAttr }),
      '지형 (OpenTopoMap)': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        subdomains: 'abc', maxNativeZoom: 17, maxZoom: 19,
        attribution: 'Map data: © OpenStreetMap contributors, SRTM | Style: © OpenTopoMap (CC-BY-SA)'
      }),
      '위성 (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxNativeZoom: 18, maxZoom: 19, attribution: 'Tiles © Esri — Maxar, Earthstar Geographics'
      })
    };
    const main = bases['OpenStreetMap'];
    main.addTo(map);
    // 공식 OSM 서버가 막히면(403 등) 자동으로 대체 서버로 전환
    let ok = 0, err = 0, switched = false;
    main.on('tileload', () => { ok++; });
    main.on('tileerror', () => {
      err++;
      if (!switched && ok === 0 && err >= 6) {
        switched = true;
        map.removeLayer(main);
        bases['OpenStreetMap (대체 서버)'].addTo(map);
        TPUtil.toast('기본 지도 서버에 연결할 수 없어 대체 서버로 전환했어요');
      }
    });
    L.control.layers(bases, null, { position: 'topright', collapsed: true }).addTo(map);
  }

  const TPMap = {
    init(opts) {
      onSelect = opts.onSelect;
      const el = document.getElementById('map');
      if (typeof L === 'undefined') {
        el.innerHTML = '<div class="map-fail">지도 라이브러리를 불러오지 못했습니다.<br>인터넷 연결을 확인하고 새로고침해 주세요.</div>';
        return false;
      }
      window.OLLE_COURSES.forEach((c) => { courseById[c.id] = c; });
      colors = TPCore.assignColors(window.OLLE_COURSES);
      map = L.map(el, { zoomControl: false }).setView([33.38, 126.55], 10);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      map.attributionControl.setPrefix(false);
      pinLayer = L.layerGroup().addTo(map);
      favLayer = L.layerGroup().addTo(map);
      searchLayer = L.layerGroup().addTo(map);
      onPickPlace = opts.onPickPlace || onPickPlace;
      map.on('contextmenu', (e) => onPickPlace(e.latlng.lat, e.latlng.lng)); // 길게 누르기(PC는 우클릭)
      addBaseLayers();
      window.OLLE_COURSES.forEach(drawCourse);
      ready = true;
      return true;
    },
    ready: () => ready,
    colorOf: (id) => colors[id],
    isExact: (id) => !!(routes[id] && routes[id].length > 1),
    exactCount: () => Object.keys(routes).filter((id) => routes[id] && routes[id].length > 1).length,

    setRoutes(r) {
      routes = r || {};
      if (!ready) return;
      window.OLLE_COURSES.forEach(drawCourse);
    },
    setScheduled(set) {
      scheduled = set;
      if (!ready) return;
      window.OLLE_COURSES.forEach((c) => restyle(c.id));
    },
    // 일정에 위치가 있는 것들을 핀으로 (날짜·시간 꼬리표 포함)
    setEventPins(events) {
      if (!ready) return;
      pinLayer.clearLayers();
      Object.keys(pinMarkers).forEach((k) => delete pinMarkers[k]);
      events.filter((e) => e.lat != null && e.lng != null && !e.course_id).forEach((e) => {
        const k = KIND[e.kind] || KIND.other;
        const icon = L.divIcon({
          className: 'pin-wrap',
          html: '<div class="pin"><span class="pin-dot">' + k.icon + '</span><span class="pin-tag">' + esc(TPUtil.fmtPinTag(e)) + '</span></div>',
          iconSize: null
        });
        const m = L.marker([e.lat, e.lng], { icon, riseOnHover: true, zIndexOffset: 600 });
        m.bindPopup(() => pinPopupHtml(e), { closeButton: true, minWidth: 190 });
        m.addTo(pinLayer);
        pinMarkers[e.id] = m;
      });
    },
    showPin(id) {
      const m = pinMarkers[id];
      if (!m || !ready) return false;
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 14));
      m.openPopup();
      return true;
    },
    // 관심 장소(날짜 없이 지도에만 ⭐ 표시)
    setPlacePins(places) {
      if (!ready) return;
      favLayer.clearLayers();
      Object.keys(favMarkers).forEach((k) => delete favMarkers[k]);
      places.forEach((pl) => {
        const icon = L.divIcon({
          className: 'pin-wrap',
          html: '<div class="pin fav"><span class="pin-dot">⭐</span><span class="pin-tag">' + esc(pl.name) + '</span></div>',
          iconSize: null
        });
        const m = L.marker([pl.lat, pl.lng], { icon, riseOnHover: true, zIndexOffset: 550 });
        m.bindPopup(() => placePopupHtml(pl), { closeButton: true, minWidth: 190 });
        m.addTo(favLayer);
        favMarkers[pl.id] = m;
      });
    },
    showPlace(id) {
      const m = favMarkers[id];
      if (!m || !ready) return false;
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 15));
      m.openPopup();
      return true;
    },
    // 검색 결과(임시 마커): 일정에 추가하기 전까지만 보인다
    showFound(place) {
      if (!ready) return;
      searchLayer.clearLayers();
      const m = L.marker([place.lat, place.lng], { icon: L.divIcon({ className: 'pin-wrap', html: '<div class="pin found"><span class="pin-dot">📍</span></div>', iconSize: null }), zIndexOffset: 900 });
      m.bindPopup(foundPopupHtml(place), { closeButton: true, minWidth: 190 });
      m.addTo(searchLayer);
      map.setView([place.lat, place.lng], Math.max(map.getZoom(), 15));
      m.openPopup();
    },
    clearFound() { if (searchLayer) searchLayer.clearLayers(); },
    setFilter(fn) {
      filterFn = fn;
      if (!ready) return;
      window.OLLE_COURSES.forEach((c) => {
        const g = groups[c.id];
        if (!g) return;
        if (fn(c)) g.group.addTo(map); else g.group.remove();
      });
    },
    select(id, opts) {
      const prev = selectedId;
      selectedId = id;
      if (!ready) return;
      if (prev && prev !== id) restyle(prev);
      if (id) {
        restyle(id);
        if (!opts || opts.fit !== false) TPMap.fit(id);
      }
    },
    fit(id) {
      if (!ready || !groups[id]) return;
      const wide = window.innerWidth >= 900;
      map.fitBounds(groups[id].line.getBounds(), {
        paddingTopLeft: [30, 70],
        paddingBottomRight: wide ? [450, 30] : [30, Math.round(window.innerHeight * 0.55)],
        maxZoom: 13, animate: true
      });
    },
    invalidate() { if (ready) map.invalidateSize(); }
  };
  window.TPMap = TPMap;
})();
