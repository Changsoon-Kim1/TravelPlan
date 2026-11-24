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
  // 긴 변 480px 썸네일(방향 적용, EXIF 제거된 새 JPEG)
  async function thumb(file) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const k = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k));
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      if (bmp.close) bmp.close();
      return { url: cv.toDataURL('image/jpeg', 0.78), w: cv.width, h: cv.height };
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

  // ---- SVG ----
  function mapSVG(track, pins) {
    const pts = [];
    if (track) track.forEach((p) => pts.push([p.lat, p.lon]));
    pins.forEach((p) => pts.push([p.loc.lat, p.loc.lon]));
    if (!pts.length) return '';
    const lat0 = pts.reduce((a, p) => a + p[0], 0) / pts.length, kx = Math.cos(lat0 * Math.PI / 180);
    const xs = pts.map((p) => p[1] * kx), ys = pts.map((p) => p[0]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 28, W = 640, spanX = Math.max(maxX - minX, 1e-5), spanY = Math.max(maxY - minY, 1e-5);
    const H = Math.round(Math.min(560, Math.max(240, (W - 2 * pad) * spanY / spanX + 2 * pad)));
    const sc = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
    const ox = (W - spanX * sc) / 2, oy = (H - spanY * sc) / 2;
    const X1 = (lon) => ox + (lon * kx - minX) * sc, Y1 = (lat) => H - (oy + (lat - minY) * sc);
    let h = '<svg class="map" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="걸은 길과 사진 위치(북쪽이 위)">';
    if (track) {
      const step = Math.max(1, Math.floor(track.length / 900));
      let line = '';
      for (let i = 0; i < track.length; i += step) line += X1(track[i].lon).toFixed(1) + ',' + Y1(track[i].lat).toFixed(1) + ' ';
      const l = track[track.length - 1]; line += X1(l.lon).toFixed(1) + ',' + Y1(l.lat).toFixed(1);
      h += '<polyline points="' + line + '" fill="none" stroke="#fff" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<polyline points="' + line + '" fill="none" stroke="#0f766e" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>';
      const f = track[0];
      h += '<circle cx="' + X1(f.lon).toFixed(1) + '" cy="' + Y1(f.lat).toFixed(1) + '" r="6" fill="#16a34a" stroke="#fff" stroke-width="2"/>' +
        '<circle cx="' + X1(l.lon).toFixed(1) + '" cy="' + Y1(l.lat).toFixed(1) + '" r="6" fill="#dc2626" stroke="#fff" stroke-width="2"/>';
    }
    pins.forEach((p) => {
      const x = X1(p.loc.lon).toFixed(1), y = Y1(p.loc.lat).toFixed(1);
      h += '<circle cx="' + x + '" cy="' + y + '" r="10" fill="#ea580c" stroke="#fff" stroke-width="2"/>' +
        '<text x="' + x + '" y="' + (+y + 3.8).toFixed(1) + '" font-size="10.5" font-weight="700" fill="#fff" text-anchor="middle">' + p.no + '</text>';
    });
    return h + '</svg>';
  }
  function elevSVG(track, pins) {
    const hasEle = track && track.filter((p) => p.ele != null).length > track.length * 0.8;
    if (!hasEle) return '';
    const cum = [0];
    for (let i = 1; i < track.length; i++) cum.push(cum[i - 1] + C.haversineKm([track[i - 1].lat, track[i - 1].lon], [track[i].lat, track[i].lon]));
    const total = cum[cum.length - 1] || 1;
    const es = track.map((p) => (p.ele == null ? 0 : p.ele));
    const mn = Math.min(...es.filter((v, i) => track[i].ele != null)), mx = Math.max(...es);
    const W = 640, H = 190, L = 40, R = 10, T = 14, B = 24;
    const span = Math.max(mx - mn, 10), lo = mn - span * 0.06, hi = mx + span * 0.12;
    const Xp = (d) => L + (d / total) * (W - L - R), Yp = (e) => T + (1 - (e - lo) / (hi - lo)) * (H - T - B);
    const step = Math.max(1, Math.floor(track.length / 400));
    let line = '';
    for (let i = 0; i < track.length; i += step) line += Xp(cum[i]).toFixed(1) + ',' + Yp(es[i]).toFixed(1) + ' ';
    line += Xp(total).toFixed(1) + ',' + Yp(es[es.length - 1]).toFixed(1);
    let h = '<svg class="elev" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="고도 프로필과 사진 위치">' +
      '<polygon points="' + line + ' ' + Xp(total).toFixed(1) + ',' + (H - B) + ' ' + L + ',' + (H - B) + '" fill="#0f766e" fill-opacity=".16"/>' +
      '<polyline points="' + line + '" fill="none" stroke="#0f766e" stroke-width="2" stroke-linejoin="round"/>' +
      '<text x="' + (L - 4) + '" y="' + (Yp(mx) + 3).toFixed(1) + '" font-size="10" text-anchor="end" fill="#64748b">' + Math.round(mx) + 'm</text>' +
      '<text x="' + (L - 4) + '" y="' + (Yp(mn) + 3).toFixed(1) + '" font-size="10" text-anchor="end" fill="#64748b">' + Math.round(mn) + 'm</text>';
    const kmStep = total > 12 ? 4 : total > 5 ? 2 : 1;
    for (let k = 0; k <= total + 0.01; k += kmStep) h += '<text x="' + Xp(k).toFixed(1) + '" y="' + (H - 6) + '" font-size="10" text-anchor="middle" fill="#64748b">' + k + 'km</text>';
    pins.forEach((p) => {
      if (!p.loc.track) return;
      // 사진 시각에 가장 가까운 기록 점의 누적 거리에 찍는다
      let lo2 = 0, hi2 = track.length - 1;
      while (hi2 - lo2 > 1) { const m = (lo2 + hi2) >> 1; if (track[m].t <= p.tAdj) lo2 = m; else hi2 = m; }
      const i = Math.abs(track[lo2].t - p.tAdj) <= Math.abs(track[hi2].t - p.tAdj) ? lo2 : hi2;
      const x = Xp(cum[i]).toFixed(1), y = Yp(es[i]).toFixed(1);
      h += '<line x1="' + x + '" y1="' + y + '" x2="' + x + '" y2="' + (H - B) + '" stroke="#ea580c" stroke-opacity=".35"/>' +
        '<circle cx="' + x + '" cy="' + y + '" r="8.5" fill="#ea580c" stroke="#fff" stroke-width="1.5"/>' +
        '<text x="' + x + '" y="' + (+y + 3.5).toFixed(1) + '" font-size="9.5" font-weight="700" fill="#fff" text-anchor="middle">' + p.no + '</text>';
    });
    return h + '</svg>';
  }

  const HOW = {
    photo: ['📍', '사진 GPS'], track: ['🧭', 'GPX 시간 맞춤'], edge: ['🧭', 'GPX 끝 지점'], none: ['❔', '위치 없음']
  };
  function capHTML(p) {
    const l = p.loc, w = HOW[l.how];
    let note = '';
    if (l.how === 'edge') note = '<div class="warn">기록 ' + (p.tAdj < (p._trackStart || 0) ? '시작 ' : '종료 ') + Math.round(l.gapSec / 60 * 10) / 10 + '분 ' + (p.tAdj < (p._trackStart || 0) ? '전' : '뒤') + '에 찍어 가까운 끝 지점으로 표시</div>';
    else if (l.approx && l.how === 'track') note = '<div class="warn">기록 간격이 길어 대략적인 위치</div>';
    else if (l.how === 'none' && p.tAdj != null) note = '<div class="warn">기록 시간 밖이라 위치를 알 수 없어요</div>';
    return '<div class="cap"><span class="no">' + (p.no || '–') + '</span><b>' + (p.tAdj != null ? hm(p.tAdj) : '시각 모름') + '</b>' +
      (l.ele != null ? ' · 고도 ' + Math.round(l.ele) + 'm' : '') +
      '<div class="src">' + w[0] + ' ' + w[1] + ' · 시각: ' + esc(p.timeFrom || '없음') + '</div>' + note + '</div>';
  }

  function buildReport(title, track, photos) {
    const stats = track ? C.trackStats(track) : null;
    const pinned = photos.filter((p) => p.loc.how !== 'none');
    photos.forEach((p, i) => { p.no = i + 1; p._trackStart = track ? track[0].t : 0; });
    const first = stats ? stats.start : (photos.find((p) => p.tAdj != null) || {}).tAdj;
    const last = stats ? stats.end : null;
    let h = '<article class="rp" id="rp"><h1>' + esc(title) + '</h1><div class="rp-sub">' +
      (first != null ? esc(dayLabel(first)) : '') + (stats ? ' · ' + hm(stats.start) + ' ~ ' + hm(last) : '') + ' · 사진 ' + photos.length + '장</div>';
    if (stats) {
      h += '<section class="rp-sec"><h2>한눈에 보기</h2><div class="stats">' +
        '<div><small>거리</small><b>' + stats.km.toFixed(1) + 'km</b></div>' +
        '<div><small>총 시간 / 이동</small><b>' + dur(stats.totalSec) + '</b><small>이동 ' + dur(stats.movingSec) + '</small></div>' +
        '<div><small>누적 오르막</small><b>' + Math.round(stats.up) + 'm</b><small>내리막 ' + Math.round(stats.down) + 'm</small></div>' +
        '<div><small>고도</small><b>' + (stats.max != null ? Math.round(stats.max) + 'm' : '–') + '</b><small>최저 ' + (stats.min != null ? Math.round(stats.min) + 'm' : '–') + '</small></div></div></section>';
    }
    const m = mapSVG(track, pinned);
    if (m) h += '<section class="rp-sec"><h2>걸은 길과 사진 위치</h2>' + m + '<div class="muted sm">초록 시작 · 빨강 끝 · 주황 번호는 사진</div></section>';
    const e = elevSVG(track, pinned);
    if (e) h += '<section class="rp-sec"><h2>고도와 사진</h2>' + e + '</section>';
    // 사진: 날짜별
    const days = [];
    photos.forEach((p) => { const k = p.tAdj != null ? dayKey(p.tAdj) : '시각 모름'; let g = days.find((d) => d.k === k); if (!g) { g = { k, ms: p.tAdj, list: [] }; days.push(g); } g.list.push(p); });
    h += '<section class="rp-sec"><h2>사진</h2>';
    days.forEach((g) => {
      if (days.length > 1 || g.k === '시각 모름') h += '<div class="daytitle">' + (g.ms != null ? esc(dayLabel(g.ms)) : '시각을 알 수 없는 사진') + '</div>';
      h += '<div class="photos">' + g.list.map((p) => '<figure class="ph" style="margin:0">' + (p.thumb ? '<img alt="사진 ' + p.no + '" src="' + p.thumb.url + '">' : '<div style="padding:30px 8px;text-align:center" class="muted">미리보기 없음<br>' + esc(p.name) + '</div>') + capHTML(p) + '</figure>').join('') + '</div>';
    });
    h += '</section><div class="foot">이 리포트는 이 기기에서만 만들어졌고 서버에 저장되지 않았어요 · 만든 날 ' + esc(new Date().toISOString().slice(0, 10)) + '</div></article>';
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
      const st = track ? C.trackStats(track) : null;
      const title = $('title').value.trim() || (st ? dayLabel(st.start) + ' 기록' : '사진 앨범');
      $('out').innerHTML = '<div class="bar noprint" style="margin:0 0 10px"><button class="btn primary" id="doPrint" type="button">🖨 PDF로 저장 / 인쇄</button>' +
        '<button class="btn" id="doSave" type="button">💾 HTML 파일로 저장</button></div>' + buildReport(title, track, photos);
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
    const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(title) + '</title><style>' + css + '</style></head><body><div class="wrap">' + $('rp').outerHTML + '</div></body></html>';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = (title.replace(/[\\/:*?"<>|]+/g, '_') || 'album') + '.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  $('make').addEventListener('click', make);
})();
