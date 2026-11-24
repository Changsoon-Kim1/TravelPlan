/* 화면과 무관한 순수 로직 (브라우저/노드 공용, tests/ 에서 테스트) */
(function (root) {
  'use strict';

  // ---------- 코스 색상: 인접한 코스는 서로 다른 색 ----------
  const PALETTE = ['#e11d48', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2'];

  function mainNum(id) { return parseInt(id, 10); }

  function areAdjacent(a, b) {
    if (a.id === b.id) return false;
    const ma = mainNum(a.id), mb = mainNum(b.id);
    if (ma === mb) return true;
    const d = Math.abs(ma - mb);
    return d === 1 || d === 20; // 1~21코스는 섬을 한 바퀴 도는 고리 (21 ↔ 1)
  }

  function assignColors(courses, palette) {
    palette = palette || PALETTE;
    const sorted = courses.slice().sort((x, y) => (x.id < y.id ? -1 : 1));
    const colorOf = {};
    for (const c of sorted) {
      const used = new Set();
      for (const o of sorted) {
        if (colorOf[o.id] !== undefined && areAdjacent(c, o)) used.add(colorOf[o.id]);
      }
      let k = 0;
      while (used.has(k)) k++;
      colorOf[c.id] = k % palette.length;
    }
    const out = {};
    for (const id in colorOf) out[id] = palette[colorOf[id]];
    return out;
  }

  // ---------- 날짜/시간 (타임존 영향 없이 문자열로만 계산) ----------
  function pad2(n) { return String(n).padStart(2, '0'); }
  function toMin(hhmm) {
    if (!hhmm) return null;
    const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  }
  function fromMin(min) { return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60); }
  function normTime(t) { return t ? String(t).slice(0, 5) : null; }

  function parseISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return { y, m, d };
  }
  function toISO(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function addDays(iso, n) {
    const { y, m, d } = parseISO(iso);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  function weekday(iso) { // 0=일
    const { y, m, d } = parseISO(iso);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }
  function dateRange(startISO, endISO) {
    const out = [];
    for (let d = startISO; d <= endISO; d = addDays(d, 1)) out.push(d);
    return out;
  }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  // 시작 시각 + 코스 최대 소요시간 → 기본 종료 시각 (예: 10:00 + 5h = 15:00)
  function defaultEnd(startHHMM, maxHours) {
    const s = toMin(startHHMM);
    if (s === null) return null;
    return fromMin(Math.min(s + Math.round(maxHours * 60), 23 * 60 + 59));
  }

  // ---------- 일정 ----------
  function eventCoversDay(ev, iso) {
    const last = ev.end_day || ev.day;
    return iso >= ev.day && iso <= last;
  }
  function compareEvents(a, b) {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    const sa = toMin(a.start_time), sb = toMin(b.start_time);
    if (sa === null && sb !== null) return -1;
    if (sa !== null && sb === null) return 1;
    if (sa !== sb) return sa - sb;
    return (a.title || '').localeCompare(b.title || '');
  }
  // 시간이 있는 일정끼리만 겹침 판단. 종료 시각이 없는 일정(항공편 등)은 60분으로 본다.
  function timedSpan(ev) {
    const s = toMin(ev.start_time);
    if (s === null) return null;
    const e = toMin(ev.end_time);
    return [s, e !== null && e > s ? e : s + 60];
  }
  function findOverlaps(candidate, events, ignoreId) {
    const c = timedSpan(candidate);
    if (!c) return [];
    return events.filter((ev) => {
      if (ev.id === ignoreId || ev.day !== candidate.day) return false;
      const o = timedSpan(ev);
      return o && c[0] < o[1] && o[0] < c[1];
    });
  }

  // ---------- GPX ----------
  function haversineKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function pathLengthKm(path) {
    let s = 0;
    for (let i = 1; i < path.length; i++) s += haversineKm(path[i - 1], path[i]);
    return s;
  }
  function parseGpx(text) {
    const pts = [];
    const re = /<(trkpt|rtept)\b([^>]*)>/gi;
    let m;
    while ((m = re.exec(text))) {
      const lat = /\blat\s*=\s*["']([-\d.eE+]+)["']/.exec(m[2]);
      const lon = /\blon\s*=\s*["']([-\d.eE+]+)["']/.exec(m[2]);
      if (lat && lon) {
        const la = parseFloat(lat[1]), lo = parseFloat(lon[1]);
        if (isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) pts.push([la, lo]);
      }
    }
    return pts;
  }
  // 반복형 Douglas-Peucker (점이 많아도 재귀 깊이 문제 없음)
  function simplifyPath(points, tolMeters) {
    if (points.length <= 2) return points.slice();
    const lat0 = points[0][0] * Math.PI / 180;
    const kx = 111320 * Math.cos(lat0), ky = 110574;
    const P = points.map((p) => [p[1] * kx, p[0] * ky]);
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let maxD = 0, idx = -1;
      const ax = P[a][0], ay = P[a][1], bx = P[b][0], by = P[b][1];
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      for (let i = a + 1; i < b; i++) {
        let d;
        if (len2 === 0) d = Math.hypot(P[i][0] - ax, P[i][1] - ay);
        else {
          let t = ((P[i][0] - ax) * dx + (P[i][1] - ay) * dy) / len2;
          t = Math.max(0, Math.min(1, t));
          d = Math.hypot(P[i][0] - (ax + t * dx), P[i][1] - (ay + t * dy));
        }
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > tolMeters && idx > 0) {
        keep[idx] = 1;
        stack.push([a, idx], [idx, b]);
      }
    }
    return points.filter((_, i) => keep[i]);
  }
  function compactPath(points, maxPoints) {
    let tol = 5, out = simplifyPath(points, tol);
    while (out.length > (maxPoints || 1500) && tol < 200) { tol *= 1.6; out = simplifyPath(points, tol); }
    return out.map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
  }
  // 파일 이름에서 코스 번호 추측: "올레 10코스.gpx", "olle_03-A", "7-1코스" ...
  function guessCourseId(filename, validIds) {
    const name = String(filename).replace(/\.[^.]+$/, '');
    const m = /(\d{1,2})\s*[-_ ]?\s*([1-2]|[aAbB])?\s*(?:코스|course|$|[^0-9a-zA-Z])/i.exec(name);
    if (!m) return null;
    const num = pad2(parseInt(m[1], 10));
    const suf = m[2] ? (/[ab]/i.test(m[2]) ? m[2].toUpperCase() : m[2]) : '';
    const exact = suf ? num + '-' + suf : num;
    return validIds.includes(exact) ? exact : null;
  }

  // ---------- 근사 경로 (임시 대략선) ----------
  function approxPath(spec, anchors, hallasan) {
    hallasan = hallasan || [33.3617, 126.5330];
    if (spec.loop) {
      const { center, rLat, rLon } = spec.loop, out = [];
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * 2 * Math.PI;
        out.push([center[0] + rLat * Math.sin(a), center[1] + rLon * Math.cos(a)]);
      }
      return out;
    }
    const pts = spec.pts.map((n) => anchors[n]);
    if (!spec.bow || pts.length !== 2) return pts;
    const [a, b] = pts;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let vx = hallasan[0] - mid[0], vy = hallasan[1] - mid[1];
    const n = Math.hypot(vx, vy) || 1;
    vx /= n; vy /= n;
    const ctrl = [mid[0] + vx * spec.bow * 2, mid[1] + vy * spec.bow * 2];
    const out = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * ctrl[0] + t * t * b[0], u * u * a[1] + 2 * u * t * ctrl[1] + t * t * b[1]]);
    }
    return out;
  }

  const api = {
    PALETTE, mainNum, areAdjacent, assignColors,
    pad2, toMin, fromMin, normTime, parseISO, toISO, addDays, weekday, dateRange, daysInMonth, defaultEnd,
    eventCoversDay, compareEvents, findOverlaps,
    haversineKm, pathLengthKm, parseGpx, simplifyPath, compactPath, guessCourseId, approxPath
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TPCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
