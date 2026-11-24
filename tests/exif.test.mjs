import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../js/core.js');
globalThis.TPCore = C;
const X = require('../js/exif.js');
const buf = (f) => { const b = fs.readFileSync(new URL('./fixtures/' + f, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };

test('EXIF: 촬영 시각·시간대·GPS 읽기', () => {
  const e = X.parse(buf('20261122_141814.jpg'));
  assert.equal(e.local, '2026:11:22 14:18:14');
  assert.equal(e.offset, '+09:00');
  assert.ok(Math.abs(e.lat - 36.5412432) < 1e-4 && Math.abs(e.lon - 127.8329114) < 1e-4);
  assert.equal(Math.round(e.alt), 380);
  assert.equal(new Date(e.gpsUtcMs).toISOString(), '2026-11-22T05:18:14.000Z');
});
test('시각 우선순위: EXIF(+오프셋) → GPS시각 → EXIF(기본 시간대) → 파일 이름', () => {
  const a = X.describe(X.parse(buf('20261122_141814.jpg')), 'x.jpg', null, 540);
  assert.equal(new Date(a.t).toISOString(), '2026-11-22T05:18:14.000Z'); assert.equal(a.timeFrom, 'EXIF');
  const b = X.describe(X.parse(buf('20261122_103000.jpg')), 'x.jpg', null, 540);   // 오프셋 없음 → 한국 시간으로 해석
  assert.equal(new Date(b.t).toISOString(), '2026-11-22T01:30:00.000Z'); assert.equal(b.lat, null);
  const c = X.describe(X.parse(buf('20261122_120005.jpg')), '20261122_120005.jpg', null, 540); // EXIF 없음
  assert.equal(X.parse(buf('20261122_120005.jpg')), null);
  assert.equal(new Date(c.t).toISOString(), '2026-11-22T03:00:05.000Z'); assert.equal(c.timeFrom, '파일 이름');
  assert.equal(X.parse(new ArrayBuffer(8)), null);
});
test('파일 이름 시각·기록 위치 맞춤', () => {
  assert.equal(new Date(C.nameTime('20261122_141814.Jpg', 540)).toISOString(), '2026-11-22T05:18:14.000Z');
  assert.equal(C.nameTime('IMG_1234.jpg'), null);
  const tr = [0, 60000, 120000, 600000].map((t, i) => ({ lat: 36 + i * 0.01, lon: 127, ele: 100 + i * 10, t: 1e12 + t }));
  const mid = C.locateOnTrack(tr, 1e12 + 30000);
  assert.ok(mid.inside && Math.abs(mid.lat - 36.005) < 1e-9 && mid.ele === 105 && !mid.approx);
  assert.ok(C.locateOnTrack(tr, 1e12 + 300000).approx);          // 앞뒤 점 간격이 2분 초과
  const after = C.locateOnTrack(tr, 1e12 + 600000 + 100000);      // 기록 끝 100초 뒤 → 끝 점
  assert.ok(!after.inside && after.gapSec === 100 && after.lat === 36.03);
  assert.equal(C.locateOnTrack(tr, 1e12 + 600000 + 700000), null); // 10분 넘으면 위치 없음
  const gpx = '<trkpt lat="36.1" lon="127.1"><ele>5</ele><time>2026-11-22T00:00:00Z</time></trkpt><trkpt lat="36.2" lon="127.2"><time>bad</time></trkpt><trkpt lat="36.3" lon="127.3"><time>2026-11-22T00:01:00Z</time></trkpt>';
  assert.equal(C.parseGpxTrack(gpx).length, 2);
});
