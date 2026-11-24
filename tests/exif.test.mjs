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

test('머문 곳 찾기(findStays)와 웹 메르카토르', () => {
  const t0 = 1e12, pts = [];
  for (let i = 0; i < 10; i++) pts.push({ lat: 36 + i * 0.0005, lon: 127, ele: 0, t: t0 + i * 30000 });      // 걷기(약 55m/30초)
  for (let i = 0; i < 20; i++) pts.push({ lat: 36.005 + (i % 2) * 0.00005, lon: 127.0001, ele: 0, t: t0 + 300000 + i * 30000 }); // 식당: 10분 머묾
  for (let i = 0; i < 10; i++) pts.push({ lat: 36.005 + (i + 1) * 0.0005, lon: 127, ele: 0, t: t0 + 900000 + i * 30000 });
  const st = C.findStays(pts, 60, 300);
  assert.equal(st.length, 1);
  assert.ok(st[0].sec >= 540 && st[0].sec <= 660 && Math.abs(st[0].lat - 36.005) < 0.0005);
  assert.equal(C.findStays(pts.slice(0, 10), 60, 300).length, 0);
  assert.ok(Math.abs(C.mercX(127.0) - (127 + 180) / 360) < 1e-12);
  assert.ok(C.mercY(37) < C.mercY(36));                       // 북쪽일수록 y가 작다(아래로 증가)
  const n = 2 ** 15, y = Math.floor(C.mercY(36.5) * n), x = Math.floor(C.mercX(127.85) * n); // 슬리피 타일 공식과 일치
  assert.equal(x, Math.floor((127.85 + 180) / 360 * n));
  assert.equal(y, Math.floor((1 - Math.log(Math.tan(36.5 * Math.PI / 180) + 1 / Math.cos(36.5 * Math.PI / 180)) / Math.PI) / 2 * n));
});
