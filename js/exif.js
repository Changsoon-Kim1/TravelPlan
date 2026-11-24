/* JPEG EXIF 읽기(외부 라이브러리 없음): 촬영 시각 · GPS · 방향. 파일은 브라우저 안에서만 읽는다. */
(function (root) {
  'use strict';
  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

  function readValue(dv, tiff, entry, le) {
    const size = (TYPE_SIZE[entry.type] || 1) * entry.count;
    let off = size > 4 ? tiff + dv.getUint32(entry.pos + 8, le) : entry.pos + 8;
    if (off < 0 || off + size > dv.byteLength) return null;
    const out = [];
    for (let i = 0; i < entry.count; i++) {
      switch (entry.type) {
        case 3: out.push(dv.getUint16(off, le)); off += 2; break;
        case 4: out.push(dv.getUint32(off, le)); off += 4; break;
        case 5: { const n = dv.getUint32(off, le), d = dv.getUint32(off + 4, le); out.push(d ? n / d : 0); off += 8; break; }
        case 2: case 1: case 7: out.push(dv.getUint8(off)); off += 1; break;
        default: return null;
      }
    }
    if (entry.type === 2) {
      let s = '';
      for (const c of out) { if (c === 0) break; s += String.fromCharCode(c); }
      return s;
    }
    return out;
  }

  function readIfd(dv, tiff, ifdOff, le) {
    const res = {};
    const base = tiff + ifdOff;
    if (base < 0 || base + 2 > dv.byteLength) return res;
    const n = dv.getUint16(base, le);
    for (let i = 0; i < n && i < 200; i++) {
      const pos = base + 2 + i * 12;
      if (pos + 12 > dv.byteLength) break;
      const entry = { tag: dv.getUint16(pos, le), type: dv.getUint16(pos + 2, le), count: dv.getUint32(pos + 4, le), pos };
      if (entry.count > 64 && entry.type !== 2 && entry.type !== 7) continue;
      res[entry.tag] = readValue(dv, tiff, entry, le);
    }
    return res;
  }

  const dms = (v, ref) => {
    if (!v || v.length < 3) return null;
    const x = v[0] + v[1] / 60 + v[2] / 3600;
    return /^[SW]/i.test(ref || '') ? -x : x;
  };

  // buf: ArrayBuffer(파일 앞부분이면 충분). 반환: { local:'2026:11:22 14:18:14'|null, offset:'+09:00'|null, gpsUtcMs, lat, lon, alt, orientation } | null
  function parse(buf) {
    const dv = new DataView(buf);
    if (dv.byteLength < 12 || dv.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off + 4 < dv.byteLength) {
      const marker = dv.getUint16(off);
      if (marker === 0xFFDA || (marker & 0xFF00) !== 0xFF00) return null;
      const len = dv.getUint16(off + 2);
      if (marker === 0xFFE1 && off + 10 < dv.byteLength &&
          dv.getUint32(off + 4) === 0x45786966) { // "Exif"
        const tiff = off + 10;
        const le = dv.getUint16(tiff) === 0x4949;
        const ifd0 = readIfd(dv, tiff, dv.getUint32(tiff + 4, le), le);
        const exif = ifd0[0x8769] ? readIfd(dv, tiff, ifd0[0x8769][0], le) : {};
        const gps = ifd0[0x8825] ? readIfd(dv, tiff, ifd0[0x8825][0], le) : {};
        const r = { local: exif[0x9003] || exif[0x9004] || ifd0[0x0132] || null, offset: exif[0x9011] || null,
          gpsUtcMs: null, lat: null, lon: null, alt: null, orientation: ifd0[0x0112] ? ifd0[0x0112][0] : 1 };
        const la = dms(gps[2], gps[1]), lo = dms(gps[4], gps[3]);
        if (la != null && lo != null && isFinite(la) && isFinite(lo) && !(la === 0 && lo === 0) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) { r.lat = la; r.lon = lo; }
        if (gps[6] && gps[6].length) r.alt = (gps[5] && gps[5][0] === 1 ? -1 : 1) * gps[6][0];
        if (gps[29] && gps[7] && gps[7].length >= 3) {
          const dm = /^(\d{4}):(\d{2}):(\d{2})/.exec(gps[29]);
          if (dm) r.gpsUtcMs = Date.UTC(+dm[1], +dm[2] - 1, +dm[3]) + (gps[7][0] * 3600 + gps[7][1] * 60 + gps[7][2]) * 1000;
        }
        return r;
      }
      off += 2 + len;
    }
    return null;
  }

  // "2026:11:22 14:18:14" + 시간대(분, 동쪽이 +) → UTC ms
  function localToUtc(local, tzMin) {
    const m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(local || '');
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - tzMin * 60000;
  }
  const offsetMin = (s) => { const m = /^([+-])(\d{2}):?(\d{2})$/.exec(s || ''); return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : null; };

  /* 사진 한 장의 정보를 정리한다.
     시각 우선순위: EXIF 촬영시각+시간대오프셋 → GPS 시각(UTC) → EXIF 촬영시각(기본 시간대) → 파일 이름 → 파일 수정 시각 */
  function describe(exif, fileName, lastModified, tzMin) {
    const out = { t: null, timeFrom: null, lat: null, lon: null, alt: null, orientation: 1 };
    if (exif) {
      out.orientation = exif.orientation || 1;
      const om = offsetMin(exif.offset);
      if (exif.local && om != null) { out.t = localToUtc(exif.local, om); out.timeFrom = 'EXIF'; }
      else if (exif.gpsUtcMs != null) { out.t = exif.gpsUtcMs; out.timeFrom = 'EXIF(GPS시각)'; }
      else if (exif.local) { out.t = localToUtc(exif.local, tzMin); out.timeFrom = 'EXIF'; }
      if (exif.lat != null) { out.lat = exif.lat; out.lon = exif.lon; out.alt = exif.alt; }
    }
    if (out.t == null) {
      const nt = root.TPCore ? root.TPCore.nameTime(fileName, tzMin) : null;
      if (nt != null) { out.t = nt; out.timeFrom = '파일 이름'; }
    }
    if (out.t == null && lastModified) { out.t = lastModified; out.timeFrom = '파일 수정 시각'; }
    return out;
  }

  const api = { parse, describe, localToUtc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TPExif = api;
})(typeof window !== 'undefined' ? window : globalThis);
