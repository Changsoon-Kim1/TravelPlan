/* 장소 검색: OpenStreetMap 기반 무료 검색(Nominatim → 결과가 없으면 Photon). 키 불필요.
   Nominatim 이용 정책상 글자를 칠 때마다 자동 검색하지 않고, '검색'을 눌렀을 때만 호출한다. */
(function () {
  'use strict';
  const JEJU_VIEWBOX = '125.9,34.0,127.1,33.0'; // 제주도 근처를 우선 (왼쪽,위,오른쪽,아래)

  async function getJson(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 9000);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  function shortAddr(a) {
    if (!a) return '';
    const parts = [a.state || a.province, a.city || a.county || a.town || a.village, a.suburb || a.city_district || a.neighbourhood, a.road]
      .filter(Boolean);
    return parts.filter((x, i) => parts.indexOf(x) === i).join(' ');
  }

  async function nominatim(q) {
    const u = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&accept-language=ko&countrycodes=kr' +
      '&viewbox=' + JEJU_VIEWBOX + '&q=' + encodeURIComponent(q);
    const rows = await getJson(u);
    return rows.map((r) => ({
      name: (r.name || (r.display_name || '').split(',')[0] || q).trim(),
      addr: shortAddr(r.address) || (r.display_name || ''),
      lat: Number(r.lat), lng: Number(r.lon)
    }));
  }

  async function photon(q) {
    // 제주도 중심 좌표를 주면 가까운 결과가 앞에 온다
    const u = 'https://photon.komoot.io/api/?limit=8&lat=33.38&lon=126.55&q=' + encodeURIComponent(q);
    const j = await getJson(u);
    return (j.features || []).filter((f) => f.geometry && f.geometry.coordinates).map((f) => {
      const p = f.properties || {};
      return {
        name: (p.name || p.street || q).trim(),
        addr: [p.state, p.city || p.county, p.district, p.street].filter(Boolean).join(' '),
        lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0]
      };
    }).filter((r) => r.lat >= 32.5 && r.lat <= 34.2 && r.lng >= 125.5 && r.lng <= 127.3); // 제주 권역만
  }

  async function search(q) {
    q = (q || '').trim();
    if (!q) return [];
    let out = [], failed = 0;
    try { out = await nominatim(q); } catch (e) { failed++; }
    if (!out.length) {
      try { out = await photon(q); } catch (e) { failed++; }
    }
    if (!out.length && failed >= 2) throw new Error('장소 검색 서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    // 같은 좌표(소수 4자리)에 같은 이름은 하나로
    const seen = new Set();
    return out.filter((r) => { const k = r.name + r.lat.toFixed(4) + r.lng.toFixed(4); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  async function reverse(lat, lng) {
    try {
      const r = await getJson('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=ko&lat=' + lat + '&lon=' + lng);
      const name = (r.name || (r.display_name || '').split(',')[0] || '').trim();
      return { name: name || '선택한 위치', addr: shortAddr(r.address) };
    } catch (e) { return { name: '선택한 위치', addr: '' }; }
  }

  window.TPPlaces = { search, reverse };
})();
