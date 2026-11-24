/* 지도: Leaflet + OpenStreetMap 계열(키 불필요). 코스를 색으로 구분해 그린다. */
(function () {
  'use strict';
  const { esc } = TPUtil;

  let map = null;
  let ready = false;
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
  function lineStyle(c, exact) {
    const sel = selectedId === c.id, sch = scheduled.has(c.id);
    return {
      color: colors[c.id], weight: sel ? 6 : (sch ? 5 : 4), opacity: sel ? 1 : 0.92,
      dashArray: exact ? null : '9 9', lineCap: 'round', lineJoin: 'round'
    };
  }
  // 선 아래에 깔리는 흰 테두리: 지도 위에서 선이 또렷하고 깔끔해 보이게 한다
  function casingStyle(c) {
    const sel = selectedId === c.id;
    return { color: '#fff', weight: sel ? 10 : 7, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false };
  }
  function badgeIcon(c) {
    const sel = selectedId === c.id, sch = scheduled.has(c.id);
    return L.divIcon({
      className: 'course-badge-wrap',
      html: '<div class="course-badge' + (sel ? ' sel' : '') + (sch ? ' sch' : '') + '" style="background:' + colors[c.id] + '">' +
        esc(labelText(c)) + (sch ? '<i>✓</i>' : '') + '</div>',
      iconSize: null
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
    if (selectedId === id) { g.casing.bringToFront(); g.line.bringToFront(); }
  }

  function addBaseLayers() {
    const osmAttr = '© OpenStreetMap contributors';
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
      map = L.map(el, { zoomControl: true }).setView([33.38, 126.55], 10);
      map.attributionControl.setPrefix(false);
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
