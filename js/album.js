/* 여행 앨범 리포트: GPX 기록 + 사진(EXIF 시각·GPS)을 이 기기 안에서만 맞춰 리포트를 만든다. 네트워크 전송 없음. */
(function () {
  'use strict';
  const C = TPCore, X = TPExif;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  let tzMin = 540;

  // 현지 시각 문자열 (UTC ms → 기준 시간대의 날짜/시각)
  function parts(ms) { const d = new Date(ms + tzMin * 60000); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay() }; }
  const p2 = (n) => String(n).padStart(2, '0');
  const dayKey = (ms) => { const p = parts(ms); return p.y + '-' + p2(p.mo) + '-' + p2(p.d); };
  const dayLabel = (ms) => { const p = parts(ms); return p.y + '년 ' + p.mo + '월 ' + p.d + '일(' + WD[p.wd] + ')'; };
  const hm = (ms) => { const p = parts(ms); return p2(p.h) + ':' + p2(p.mi); };
  const dur = (sec) => { const m = Math.round(sec / 60); return Math.floor(m / 60) + '시간 ' + p2(m % 60) + '분'; };

  async function readExif(file) {
    try { return X.parse(await file.slice(0, 262144).arrayBuffer()); } catch (e) { return null; }
  }
  // 긴 변 640px 썸네일(방향 적용, EXIF 제거된 새 JPEG)
  async function thumb(file) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const k = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k));
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      if (bmp.close) bmp.close();
      return { url: cv.toDataURL('image/jpeg', 0.8), w: cv.width, h: cv.height };
    } catch (e) { return null; }
  }

  // 사진마다 시각·위치를 정리하고 기록과 맞춘다
  function place(photo, track, shiftSec) {
    const out = { how: 'none', lat: null, lon: null, ele: null, gapSec: 0, approx: false };
    const t = photo.t == null ? null : photo.t + shiftSec * 1000;
    photo.tAdj = t;
    if (photo.lat != null) { out.how = 'photo'; out.lat = photo.lat; out.lon = photo.lon; out.ele = photo.alt; }
    if (track && t != null) {
      const g = C.locateOnTrack(track, t, 600);
      if (g) {
        out.track = g;
        if (out.how === 'none') { out.how = g.inside ? 'track' : 'edge'; out.lat = g.lat; out.lon = g.lon; out.ele = g.ele; out.gapSec = g.gapSec; out.approx = g.approx; }
        else if (out.ele == null) out.ele = g.ele;
      }
    }
    photo.loc = out;
  }

  // ---- 장면(챕터) 묶기: 시간이 20분 넘게 벌어지거나 500m 넘게 떨어지면 새 장면 ----
  function chaptersOf(photos, track, stays) {
    const list = [];
    let cur = null;
    photos.forEach((p) => {
      const hasT = p.tAdj != null;
      const here = p.loc.how !== 'none' ? p.loc : null;
      const lastP = cur && cur.photos[cur.photos.length - 1];
      let split = !cur || !hasT || cur.noTime;
      if (!split && lastP) {
        if (p.tAdj - lastP.tAdj > 20 * 60000) split = true;
        else if (here && cur.loc && C.haversineKm([cur.loc.lat, cur.loc.lon], [here.lat, here.lon]) > 0.5) split = true;
      }
      if (hasT && cur && cur.noTime) split = true;
      if (split) { cur = { photos: [], loc: null, noTime: !hasT }; list.push(cur); }
      cur.photos.push(p);
      if (here && !cur.loc) cur.loc = here;
    });
    list.forEach((c, i) => {
      c.n = i + 1;
      const ts = c.photos.map((p) => p.tAdj).filter((x) => x != null);
      c.t0 = ts.length ? Math.min(...ts) : null; c.t1 = ts.length ? Math.max(...ts) : null;
      const ele = c.photos.map((p) => p.loc.ele).filter((x) => x != null);
      c.ele = ele.length ? ele.reduce((x, y) => x + y, 0) / ele.length : null;
      c.idx = null;
      if (track && c.loc) {
        if (c.t0 != null && c.photos.some((p) => p.loc.track)) {
          let lo = 0, hi = track.length - 1; const tm = (c.t0 + c.t1) / 2;
          while (hi - lo > 1) { const m = (lo + hi) >> 1; if (track[m].t <= tm) lo = m; else hi = m; }
          c.idx = Math.abs(track[lo].t - tm) <= Math.abs(track[hi].t - tm) ? lo : hi;
        } else { // 시각을 못 맞춘 사진은 위치가 가장 가까운 기록 점에 놓는다
          let best = 0, bd = Infinity;
          for (let k = 0; k < track.length; k += 3) { const d = (track[k].lat - c.loc.lat) ** 2 + (track[k].lon - c.loc.lon) ** 2; if (d < bd) { bd = d; best = k; } }
          c.idx = best;
        }
      }
      // 머문 곳(식당 등): 이 장면의 위치·시각이 머묾 구간 안(앞뒤 5분 여유)이면 연결
      c.stay = null;
      (stays || []).forEach((st) => {
        const inIdx = c.idx != null && c.idx >= st.i0 && c.idx <= st.i1;
        const inTime = c.t0 != null && c.t1 >= st.t0 - 300000 && c.t0 <= st.t1 + 300000 && c.loc && C.haversineKm([c.loc.lat, c.loc.lon], [st.lat, st.lon]) * 1000 <= 150;
        if (!c.stay && (inIdx || inTime)) c.stay = st;
      });
    });
    return list;
  }

  // ---- SVG ----
  function makeProj(pts, W, minH, maxH) {
    const xs = pts.map((p) => C.mercX(p[1])), ys = pts.map((p) => C.mercY(p[0]));
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 24, spanX = Math.max(maxX - minX, 3e-5), spanY = Math.max(maxY - minY, 3e-5); // 최소 약 600m
    const H = Math.round(Math.min(maxH, Math.max(minH, (W - 2 * pad) * spanY / spanX + 2 * pad)));
    const sc = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
    const ox = (W - spanX * sc) / 2, oy = (H - spanY * sc) / 2;
    const fx = (wx) => (wx - minX) * sc + ox, fy = (wy) => (wy - minY) * sc + oy;
    return {
      W, H, sc, fx, fy,
      X: (lon) => fx(C.mercX(lon)).toFixed(1), Y: (lat) => fy(C.mercY(lat)).toFixed(1),
      wx0: minX - ox / sc, wx1: minX + (W - ox) / sc, wy0: minY - oy / sc, wy1: minY + (H - oy) / sc
    };
  }
  const line = (track, pr, a, b, maxPts) => {
    const step = Math.max(1, Math.floor((b - a + 1) / maxPts));
    let o = '';
    for (let i = a; i <= b; i += step) o += pr.X(track[i].lon) + ',' + pr.Y(track[i].lat) + ' ';
    return o + pr.X(track[b].lon) + ',' + pr.Y(track[b].lat);
  };
  const badge = (x, y, r, n, fill) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + (fill || '#ea580c') + '" stroke="#fff" stroke-width="2"/>' +
    '<text x="' + x + '" y="' + (+y + r * 0.38).toFixed(1) + '" font-size="' + (r * 1.05).toFixed(1) + '" font-weight="700" fill="#fff" text-anchor="middle">' + n + '</text>';

  function makePr(track, photos) {
    const pts = [];
    if (track) track.forEach((p) => pts.push([p.lat, p.lon]));
    photos.forEach((p) => { if (p.loc.how !== 'none') pts.push([p.loc.lat, p.loc.lon]); });
    return pts.length ? makeProj(pts, 640, 240, 560) : null;
  }

  // ---- 배경 지도: 타일을 이어 붙여 한 장의 그림으로 (저장한 PDF/HTML에도 그대로 들어가게) ----
  const TILES = {
    osm: { hosts: ['https://tile.openstreetmap.org', 'https://tile.openstreetmap.de'], url: (h, z, x, y) => h + '/' + z + '/' + x + '/' + y + '.png', maxZ: 17, credit: '© OpenStreetMap contributors' },
    topo: { hosts: ['https://a.tile.opentopomap.org', 'https://b.tile.opentopomap.org', 'https://c.tile.opentopomap.org'], url: (h, z, x, y) => h + '/' + z + '/' + x + '/' + y + '.png', maxZ: 17, credit: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)' }
  };
  function loadTile(kind, z, x, y) {
    const T = TILES[kind];
    const tryHost = (i) => new Promise((resolve) => {
      if (i >= T.hosts.length) return resolve(null);
      const img = new Image(); img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => { img.src = ''; resolve(tryHost(i + 1)); }, 9000);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); resolve(tryHost(i + 1)); };
      img.src = T.url(T.hosts[i], z, x, y);
    });
    return tryHost(0);
  }
  // 지도 글자가 읽히려면 타일 1칸이 화면에서 대략 200~300px 이어야 한다(타일 원본은 256px).
  // 화면 폭 ≈ 345px 에 viewBox 640 을 그리므로 타일 1칸 ≈ 430 viewBox 단위가 되는 확대 수준(z)을 고른다. detail: -1 넓게, 0 보통, +1 자세히
  async function basemap(pr, kind, detail) {
    const T = TILES[kind], f = 1.5, cv = document.createElement('canvas');
    cv.width = Math.round(pr.W * f); cv.height = Math.round(pr.H * f);
    const g = cv.getContext('2d'); g.fillStyle = '#eef2f1'; g.fillRect(0, 0, cv.width, cv.height);
    let z = Math.max(6, Math.min(T.maxZ, Math.round(Math.log2(pr.sc / 430)) + (detail || 0)));
    const range = (zz) => { const n = 2 ** zz; return { n, x0: Math.max(0, Math.floor(pr.wx0 * n)), x1: Math.min(n - 1, Math.floor(pr.wx1 * n)), y0: Math.max(0, Math.floor(pr.wy0 * n)), y1: Math.min(n - 1, Math.floor(pr.wy1 * n)) }; };
    let r = range(z);
    while ((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > 40 && z > 6) { z--; r = range(z); }
    const jobs = [];
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) jobs.push({ x, y });
    let ok = 0;
    await Promise.all(jobs.map(async (t) => {
      const img = await loadTile(kind, z, t.x, t.y);
      if (!img) return;
      ok++;
      const x0 = pr.fx(t.x / r.n) * f, y0 = pr.fy(t.y / r.n) * f, x1 = pr.fx((t.x + 1) / r.n) * f, y1 = pr.fy((t.y + 1) / r.n) * f;
      g.drawImage(img, x0, y0, x1 - x0 + 0.6, y1 - y0 + 0.6);
    }));
    if (!ok) return null;
    return { url: cv.toDataURL('image/jpeg', 0.88), credit: T.credit, z }; // 타일 서버가 허용하지 않으면 여기서 예외
  }
  const bgUse = (pr) => '<use href="#bgmap" x="0" y="0"/>';

  const stayRing = (pr, c, r) => c.stay ? '<circle cx="' + pr.X(c.loc.lon) + '" cy="' + pr.Y(c.loc.lat) + '" r="' + r + '" fill="#ea580c" fill-opacity=".14" stroke="#ea580c" stroke-width="2" stroke-dasharray="5 4"/>' : '';
  // 전체 지도: 배경 지도 + 걸은 길 + 장면 번호(머문 곳은 점선 원)
  function mapSVG(track, chapters, pr, hasBg, credit) {
    if (!pr) return '';
    let h = '<svg class="map" viewBox="0 0 ' + pr.W + ' ' + pr.H + '" role="img" aria-label="걸은 길과 장면 위치(북쪽이 위)">' + (hasBg ? bgUse(pr) : '');
    if (track) {
      const l = line(track, pr, 0, track.length - 1, 900);
      h += '<polyline points="' + l + '" fill="none" stroke="#fff" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<polyline points="' + l + '" fill="none" stroke="#0f766e" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>';
      const f = track[0], e = track[track.length - 1];
      h += '<circle cx="' + pr.X(f.lon) + '" cy="' + pr.Y(f.lat) + '" r="7" fill="#16a34a" stroke="#fff" stroke-width="2.5"/>' +
        '<circle cx="' + pr.X(e.lon) + '" cy="' + pr.Y(e.lat) + '" r="7" fill="#dc2626" stroke="#fff" stroke-width="2.5"/>';
    }
    chapters.forEach((c) => { if (c.loc) h += stayRing(pr, c, 19) + badge(pr.X(c.loc.lon), pr.Y(c.loc.lat), 11, c.n); });
    if (hasBg) h += '<text x="' + (pr.W - 6) + '" y="' + (pr.H - 6) + '" font-size="10" text-anchor="end" fill="#334155" stroke="#fff" stroke-width="3" paint-order="stroke">' + esc(credit || '© OpenStreetMap contributors') + '</text>';
    return h + '</svg>';
  }
  // 장면별 작은 지도: 전체 지도를 이 장면 주변으로 잘라서 보여 준다. 지금까지 걸은 길은 진하게, 앞으로 갈 길은 연하게.
  function miniSVG(track, chapters, c, pr, hasBg) {
    if (!pr || !c.loc) return '';
    const cw = pr.W * 0.55, ch = pr.H * 0.55;
    let x = +pr.X(c.loc.lon) - cw / 2, y = +pr.Y(c.loc.lat) - ch / 2;
    x = Math.max(0, Math.min(pr.W - cw, x)); y = Math.max(0, Math.min(pr.H - ch, y));
    let h = '<svg class="mini" viewBox="' + x.toFixed(1) + ' ' + y.toFixed(1) + ' ' + cw.toFixed(1) + ' ' + ch.toFixed(1) + '" role="img" aria-label="장면 ' + c.n + ' 위치">' + (hasBg ? bgUse(pr) : '<rect x="0" y="0" width="' + pr.W + '" height="' + pr.H + '" fill="#f8fafc"/>');
    if (track) {
      h += '<polyline points="' + line(track, pr, 0, track.length - 1, 500) + '" fill="none" stroke="#fff" stroke-width="9" stroke-linejoin="round" stroke-linecap="round" opacity=".85"/>' +
        '<polyline points="' + line(track, pr, 0, track.length - 1, 500) + '" fill="none" stroke="#94a3b8" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>';
      if (c.idx != null && c.idx > 0) h += '<polyline points="' + line(track, pr, 0, c.idx, 500) + '" fill="none" stroke="#0f766e" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>';
      h += '<circle cx="' + pr.X(track[0].lon) + '" cy="' + pr.Y(track[0].lat) + '" r="7" fill="#16a34a" stroke="#fff" stroke-width="2.5"/>';
    } else {
      chapters.forEach((o) => { if (o.loc && o !== c) h += '<circle cx="' + pr.X(o.loc.lon) + '" cy="' + pr.Y(o.loc.lat) + '" r="5" fill="#94a3b8" stroke="#fff" stroke-width="2"/>'; });
    }
    return h + (c.stay ? stayRing(pr, c, 24) : '<circle cx="' + pr.X(c.loc.lon) + '" cy="' + pr.Y(c.loc.lat) + '" r="19" fill="#ea580c" fill-opacity=".2"/>') + badge(pr.X(c.loc.lon), pr.Y(c.loc.lat), 13, c.n) + '</svg>';
  }
  function elevSVG(track, chapters, cum) {
    const hasEle = track && track.filter((p) => p.ele != null).length > track.length * 0.8;
    if (!hasEle) return '';
    const total = cum[cum.length - 1] || 1;
    const es = track.map((p) => (p.ele == null ? 0 : p.ele));
    const mn = Math.min(...es.filter((v, i) => track[i].ele != null)), mx = Math.max(...es);
    const W = 640, H = 190, L = 40, R = 10, T = 14, B = 24;
    const span = Math.max(mx - mn, 10), lo = mn - span * 0.06, hi = mx + span * 0.12;
    const Xp = (d) => L + (d / total) * (W - L - R), Yp = (e) => T + (1 - (e - lo) / (hi - lo)) * (H - T - B);
    const step = Math.max(1, Math.floor(track.length / 400));
    let ln = '';
    for (let i = 0; i < track.length; i += step) ln += Xp(cum[i]).toFixed(1) + ',' + Yp(es[i]).toFixed(1) + ' ';
    ln += Xp(total).toFixed(1) + ',' + Yp(es[es.length - 1]).toFixed(1);
    let h = '<svg class="elev" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="고도 프로필과 장면 위치">' +
      '<polygon points="' + ln + ' ' + Xp(total).toFixed(1) + ',' + (H - B) + ' ' + L + ',' + (H - B) + '" fill="#0f766e" fill-opacity=".16"/>' +
      '<polyline points="' + ln + '" fill="none" stroke="#0f766e" stroke-width="2" stroke-linejoin="round"/>' +
      '<text x="' + (L - 4) + '" y="' + (Yp(mx) + 3).toFixed(1) + '" font-size="10" text-anchor="end" fill="#64748b">' + Math.round(mx) + 'm</text>' +
      '<text x="' + (L - 4) + '" y="' + (Yp(mn) + 3).toFixed(1) + '" font-size="10" text-anchor="end" fill="#64748b">' + Math.round(mn) + 'm</text>';
    const kmStep = total > 12 ? 4 : total > 5 ? 2 : 1;
    for (let k = 0; k <= total + 0.01; k += kmStep) h += '<text x="' + Xp(k).toFixed(1) + '" y="' + (H - 6) + '" font-size="10" text-anchor="middle" fill="#64748b">' + k + 'km</text>';
    chapters.forEach((c) => {
      if (c.idx == null) return;
      const x = Xp(cum[c.idx]).toFixed(1), y = Yp(es[c.idx]).toFixed(1);
      h += '<line x1="' + x + '" y1="' + y + '" x2="' + x + '" y2="' + (H - B) + '" stroke="#ea580c" stroke-opacity=".35"/>' + badge(x, y, 9, c.n);
    });
    return h + '</svg>';
  }

  const HOW = { photo: '📍 사진 GPS', track: '🧭 GPX 시간 맞춤', edge: '🧭 GPX 끝 지점', none: '❔ 위치 없음' };
  const fmtKm = (k) => (k < 0.1 ? Math.round(k * 1000) + 'm' : k.toFixed(1) + 'km');
  const durShort = (sec) => { const m = Math.max(1, Math.round(sec / 60)); return m >= 60 ? Math.floor(m / 60) + '시간 ' + (m % 60 ? m % 60 + '분' : '') : m + '분'; };

  function chapterHTML(c, prev, track, cum, chapters, pr, hasBg) {
    let when = c.t0 == null ? '시각 모름' : (c.t1 !== c.t0 && hm(c.t1) !== hm(c.t0) ? hm(c.t0) + ' ~ ' + hm(c.t1) : hm(c.t0));
    if (c.stay) when = hm(c.stay.t0) + ' ~ ' + hm(c.stay.t1);
    let meta = '';
    if (c.stay) meta += '<span class="stay">⏸ 여기서 <b>' + durShort(c.stay.sec) + '</b> 머물렀어요</span>';

    if (c.ele != null) meta += '<span>⛰ 고도 ' + Math.round(c.ele) + 'm</span>';
    if (track && c.idx != null) {
      meta += '<span>🚶 출발 후 ' + fmtKm(cum[c.idx]) + ' · ' + durShort((track[c.idx].t - track[0].t) / 1000) + '</span>';
    }
    const warns = [];
    c.photos.forEach((p) => {
      if (p.loc.how === 'edge') warns.push('기록 ' + (p.tAdj < p._trackStart ? '시작 ' + Math.round(p.loc.gapSec / 60) + '분 전' : '종료 ' + Math.round(p.loc.gapSec / 60) + '분 뒤') + '에 찍어 끝 지점으로 표시');
      else if (p.loc.how === 'track' && p.loc.approx) warns.push('기록 간격이 길어 대략적인 위치');
      else if (p.loc.how === 'none' && p.tAdj != null) warns.push('기록 시간 밖이라 위치를 알 수 없어요');
    });
    const uniq = warns.filter((w, i) => warns.indexOf(w) === i);
    const imgs = c.photos.map((p) => '<div class="it" style="--a:' + (p.thumb ? (p.thumb.w / p.thumb.h).toFixed(3) : '1.333') + '">' +
      (p.thumb ? '<img alt="장면 ' + c.n + ' 사진" src="' + p.thumb.url + '">' : '<div class="noimg muted">미리보기 없음<br>' + esc(p.name) + '</div>') + '</div>').join('');
    return '<section class="chap"><div class="chead">' + (c.loc ? '<div class="cmap">' + miniSVG(track, chapters, c, pr, hasBg) + '</div>' : '') +
      '<div class="cinfo"><div class="ctitle"><span class="no">' + c.n + '</span><b>' + esc(when) + '</b></div>' + meta +
      uniq.map((w) => '<div class="warn">' + esc(w) + '</div>').join('') + '</div></div>' +
      '<button type="button" class="addmemo noprint">✎ 메모 추가</button><div class="memo" contenteditable="true" data-ph="이 장면에 한 줄 메모…" spellcheck="false" hidden></div>' +
      '<div class="shots ' + (c.photos.length === 1 ? 'n1' : 'nm') + '">' + imgs + '</div></section>';
  }

  function buildReport(title, track, photos, pr, bgUrl, bgCredit) {
    const stats = track ? C.trackStats(track) : null;
    photos.forEach((p) => { p._trackStart = track ? track[0].t : 0; });
    const stays = track ? C.findStays(track, 60, 300) : [];
    const chapters = chaptersOf(photos, track, stays);
    const cum = [0];
    if (track) for (let i = 1; i < track.length; i++) cum.push(cum[i - 1] + C.haversineKm([track[i - 1].lat, track[i - 1].lon], [track[i].lat, track[i].lon]));
    const first = stats ? stats.start : (photos.find((p) => p.tAdj != null) || {}).tAdj;
    const last = stats ? stats.end : null;
    let h = '<article class="rp" id="rp">' + (bgUrl ? '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><image id="bgmap" href="' + bgUrl + '" x="0" y="0" width="' + pr.W + '" height="' + pr.H + '"/></defs></svg>' : '') + '<h1>' + esc(title) + '</h1><div class="rp-sub">' +
      (first != null ? esc(dayLabel(first)) : '') + (stats ? ' · ' + hm(stats.start) + ' ~ ' + hm(last) : '') + ' · 사진 ' + photos.length + '장 · 장면 ' + chapters.length + '곳</div>';
    if (stats) {
      h += '<section class="rp-sec"><div class="stats">' +
        '<div><small>거리</small><b>' + stats.km.toFixed(1) + 'km</b></div>' +
        '<div><small>총 시간 / 이동</small><b>' + dur(stats.totalSec) + '</b><small>이동 ' + dur(stats.movingSec) + '</small></div>' +
        '<div><small>누적 오르막</small><b>' + Math.round(stats.up) + 'm</b><small>내리막 ' + Math.round(stats.down) + 'm</small></div>' +
        '<div><small>고도</small><b>' + (stats.max != null ? Math.round(stats.max) + 'm' : '–') + '</b><small>최저 ' + (stats.min != null ? Math.round(stats.min) + 'm' : '–') + '</small></div></div></section>';
    }
    const m = mapSVG(track, chapters, pr, !!bgUrl, bgCredit);
    if (m) h += '<section class="rp-sec">' + m + '<div class="muted sm">초록 시작 · 빨강 끝 · 주황 번호는 아래 이야기의 장면 번호 · 점선 원은 머문 곳</div></section>';
    const e = elevSVG(track, chapters, cum);
    if (e) h += '<section class="rp-sec">' + e + '</section>';
    h += '<section class="rp-sec story"><h2>이야기</h2>';
    let prev = null;
    chapters.forEach((c) => { h += chapterHTML(c, prev, track, cum, chapters, pr, !!bgUrl); if (c.idx != null) prev = c; });
    h += '</section><div class="foot">이 리포트는 이 기기에서만 만들어졌고 서버에 저장되지 않았어요 · 만든 날 ' + esc(new Date().toISOString().slice(0, 10)) + '</div></article>';
    window.__albumChapters = chapters.map((c) => ({ n: c.n, photos: c.photos.length, idx: c.idx, hasMap: !!c.loc, bgZ: window.__bgZ, stayMin: c.stay ? Math.round(c.stay.sec / 60) : 0 }));
    return h;
  }

  async function make() {
    const err = $('err'), prog = $('progress'), btn = $('make');
    err.hidden = true;
    const files = Array.from($('photoFiles').files || []);
    const gpxFile = ($('gpxFile').files || [])[0];
    if (!files.length && !gpxFile) { err.textContent = 'GPX 또는 사진을 하나 이상 골라 주세요.'; err.hidden = false; return; }
    tzMin = parseInt($('tz').value, 10) || 0;
    const shiftSec = parseFloat($('shift').value) || 0;
    btn.disabled = true;
    try {
      let track = null;
      if (gpxFile) {
        prog.textContent = 'GPX 읽는 중…';
        track = C.parseGpxTrack(await gpxFile.text());
        if (track.length < 2) { track = null; err.textContent = 'GPX에 시간이 있는 기록 점이 없어서 지도·시간 맞춤은 건너뛰었어요. (사진 GPS는 그대로 써요)'; err.hidden = false; }
      }
      const photos = [];
      for (let i = 0; i < files.length; i++) {
        prog.textContent = '사진 ' + (i + 1) + '/' + files.length + ' 읽는 중…';
        const f = files[i];
        const info = X.describe(await readExif(f), f.name, f.lastModified, tzMin);
        const ph = Object.assign({ name: f.name }, info);
        ph.thumb = await thumb(f);
        photos.push(ph);
      }
      photos.forEach((p) => place(p, track, shiftSec));
      photos.sort((a, b) => (a.tAdj == null) - (b.tAdj == null) || a.tAdj - b.tAdj);
      const pr = makePr(track, photos);
      let bgUrl = null, bg = null, bgCredit = '';
      if (pr && $('bg').checked) {
        prog.textContent = '배경 지도 받는 중…';
        const kind = $('bgkind').value, detail = parseInt($('bgdetail').value, 10) || 0;
        try { bg = await basemap(pr, kind, detail); } catch (e) { bg = null; }
        if (!bg && kind !== 'osm') { // 지형 지도가 안 되면 일반 지도로 한 번 더
          prog.textContent = '지형 지도를 못 받아 일반 지도로 다시 시도해요…';
          try { bg = await basemap(pr, 'osm', detail); } catch (e) { bg = null; }
        }
        bgUrl = bg ? bg.url : null; bgCredit = bg ? bg.credit : ''; window.__bgZ = bg ? bg.z : null;
        if (!bgUrl) { err.textContent = '배경 지도를 불러오지 못해 길만 표시했어요. (인터넷 연결을 확인하거나 배경 지도를 끄고 만들 수 있어요)'; err.hidden = false; }
      }
      const st = track ? C.trackStats(track) : null;
      const title = $('title').value.trim() || (st ? dayLabel(st.start) + ' 기록' : '사진 앨범');
      $('out').innerHTML = '<div class="bar noprint" style="margin:0 0 10px"><button class="btn primary" id="doPrint" type="button">🖨 PDF로 저장 / 인쇄</button>' +
        '<button class="btn" id="doSave" type="button">💾 HTML 파일로 저장</button></div>' + buildReport(title, track, photos, pr, bgUrl, bgCredit);
      $('doPrint').onclick = () => window.print();
      $('doSave').onclick = () => saveHtml(title);
      const located = photos.filter((p) => p.loc.how !== 'none').length;
      prog.textContent = '완료: 사진 ' + photos.length + '장 중 위치 확인 ' + located + '장 (사진 GPS ' + photos.filter((p) => p.loc.how === 'photo').length + ' · GPX 맞춤 ' + photos.filter((p) => p.loc.how === 'track' || p.loc.how === 'edge').length + ')';
      $('out').scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.__albumResult = photos.map((p) => ({ name: p.name, t: p.tAdj, timeFrom: p.timeFrom, how: p.loc.how, lat: p.loc.lat, lon: p.loc.lon, ele: p.loc.ele, w: p.thumb && p.thumb.w, h: p.thumb && p.thumb.h }));
    } catch (e) { err.textContent = '리포트를 만들지 못했어요: ' + (e && e.message || e); err.hidden = false; }
    btn.disabled = false;
  }

  function saveHtml(title) {
    const css = $('albumCss').textContent;
    const clone = $('rp').cloneNode(true);
    clone.querySelectorAll('.addmemo').forEach((el) => el.remove());
    clone.querySelectorAll('.memo').forEach((el) => { if (el.hidden || !el.textContent.trim()) el.remove(); else el.removeAttribute('contenteditable'); });
    const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(title) + '</title><style>' + css + '</style></head><body><div class="wrap">' + clone.outerHTML + '</div></body></html>';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = (title.replace(/[\\/:*?"<>|]+/g, '_') || 'album') + '.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // 메모: '✎ 메모 추가'를 눌러야 입력칸이 열리고, 내용이 없으면 다시 접힌다
  $('out').addEventListener('click', (e) => {
    const b = e.target.closest('.addmemo');
    if (!b) return;
    const m = b.parentNode.querySelector('.memo');
    b.hidden = true; m.hidden = false; m.focus();
  });
  $('out').addEventListener('focusout', (e) => {
    const m = e.target.closest && e.target.closest('.memo');
    if (!m || m.textContent.trim()) return;
    m.textContent = ''; m.hidden = true;
    const b = m.parentNode.querySelector('.addmemo'); if (b) b.hidden = false;
  });

  $('make').addEventListener('click', make);
})();
