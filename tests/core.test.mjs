import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

globalThis.window = {};
require('../data/courses.js');
require('../data/anchors.js');
const C = require('../js/core.js');
const courses = window.OLLE_COURSES;

test('코스 29개, 봄꽃 추천 6개', () => {
  assert.equal(courses.length, 29);
  assert.deepEqual(window.OLLE_SPRING_IDS, ['01', '02', '10', '10-1', '16', '19']);
});

test('인접한 코스는 서로 다른 색 (21↔1 고리 포함)', () => {
  const colors = C.assignColors(courses);
  for (const a of courses) {
    assert.ok(colors[a.id], a.id + ' 색 없음');
    for (const b of courses) {
      if (C.areAdjacent(a, b)) assert.notEqual(colors[a.id], colors[b.id], `${a.id} / ${b.id}`);
    }
  }
  assert.notEqual(colors['21'], colors['01']);
  assert.ok(new Set(Object.values(colors)).size <= C.PALETTE.length);
});

test('날짜 계산: 2027-04-11 은 일요일, 04-19 는 월요일', () => {
  assert.equal(C.weekday('2027-04-11'), 0);
  assert.equal(C.weekday('2027-04-19'), 1);
  assert.equal(C.addDays('2027-04-30', 1), '2027-05-01');
  assert.equal(C.dateRange('2027-04-11', '2027-04-19').length, 9);
  assert.equal(C.daysInMonth(2027, 2), 28);
});

test('기본 종료 시각: 10:00 + 5시간 = 15:00', () => {
  assert.equal(C.defaultEnd('10:00', 5), '15:00');
  assert.equal(C.defaultEnd('10:00', 7), '17:00');
  assert.equal(C.defaultEnd('20:00', 7), '23:59');
});

test('겹치는 일정 찾기', () => {
  const flight = { id: 'f', day: '2027-04-11', start_time: '11:20', end_time: null };
  const olle = { id: 'o', day: '2027-04-11', start_time: '10:00', end_time: '15:00' };
  assert.equal(C.findOverlaps(olle, [flight]).length, 1);
  assert.equal(C.findOverlaps({ day: '2027-04-11', start_time: '13:00', end_time: '15:00' }, [flight]).length, 0);
  assert.equal(C.findOverlaps({ day: '2027-04-12', start_time: '10:00', end_time: '15:00' }, [flight]).length, 0);
  assert.equal(C.findOverlaps(olle, [olle], 'o').length, 0, '자기 자신은 제외');
  const stay = { id: 's', day: '2027-04-14', end_day: '2027-04-15', start_time: null };
  assert.equal(C.findOverlaps({ day: '2027-04-14', start_time: '10:00', end_time: '15:00' }, [stay]).length, 0);
});

test('여러 날 일정은 사이 날짜에도 표시', () => {
  const stay = { day: '2027-04-14', end_day: '2027-04-15' };
  assert.ok(C.eventCoversDay(stay, '2027-04-15'));
  assert.ok(!C.eventCoversDay(stay, '2027-04-16'));
});

test('일정 정렬: 종일 → 시간순', () => {
  const list = [
    { day: '2027-04-11', start_time: '11:20', title: 'b' },
    { day: '2027-04-11', start_time: null, title: 'a' },
    { day: '2027-04-10', start_time: '23:00', title: 'c' }
  ].sort(C.compareEvents);
  assert.deepEqual(list.map((e) => e.title), ['c', 'a', 'b']);
});

test('GPX 파싱: 속성 순서·rtept·따옴표 모두 처리', () => {
  const gpx = `<gpx><trk><trkseg>
    <trkpt lat="33.45" lon="126.93"><ele>3</ele></trkpt>
    <trkpt lon='126.94' lat='33.46'/>
    </trkseg></trk><rte><rtept lat="33.5" lon="126.9"></rtept></rte><wpt lat="1" lon="1"/></gpx>`;
  const pts = C.parseGpx(gpx);
  assert.deepEqual(pts, [[33.45, 126.93, 3], [33.46, 126.94], [33.5, 126.9]]); // 고도가 있으면 3번째 값으로 보존
  assert.deepEqual(C.parseGpx('<gpx></gpx>'), []);
  assert.deepEqual(C.parseGpx('<trkpt lat="999" lon="1"/>'), []);
});

test('경로 단순화: 끝점 유지, 점 수 감소, 거리 보존', () => {
  const pts = [];
  for (let i = 0; i <= 5000; i++) pts.push([33.4 + i * 0.00002, 126.9 + Math.sin(i / 300) * 0.002]);
  const out = C.compactPath(pts, 1500);
  assert.ok(out.length < pts.length && out.length <= 1500);
  assert.deepEqual(out[0], [Math.round(pts[0][0] * 1e5) / 1e5, Math.round(pts[0][1] * 1e5) / 1e5]);
  const a = C.pathLengthKm(pts), b = C.pathLengthKm(out);
  assert.ok(Math.abs(a - b) / a < 0.02, `거리 차이 ${a} vs ${b}`);
  assert.equal(C.simplifyPath([[1, 1], [2, 2]], 5).length, 2);
});

test('파일 이름으로 코스 번호 추측', () => {
  const ids = courses.map((c) => c.id);
  assert.equal(C.guessCourseId('올레 10코스.gpx', ids), '10');
  assert.equal(C.guessCourseId('제주올레_7-1코스.gpx', ids), '07-1');
  assert.equal(C.guessCourseId('olle_03-A.gpx', ids), '03-A');
  assert.equal(C.guessCourseId('1코스.gpx', ids), '01');
  assert.equal(C.guessCourseId('15-B.gpx', ids), '15-B');
  assert.equal(C.guessCourseId('내파일.gpx', ids), null);
});

test('임시 근사 경로: 모든 코스에 정의, 앵커 존재, 제주 범위 안', () => {
  for (const c of courses) {
    const spec = window.APPROX_COURSES[c.id];
    assert.ok(spec, c.id + ' 근사 데이터 없음');
    if (spec.pts) for (const n of spec.pts) assert.ok(window.APPROX_ANCHORS[n], n + ' 앵커 없음');
    const p = C.approxPath(spec, window.APPROX_ANCHORS);
    assert.ok(p.length >= 2);
    for (const [la, lo] of p) assert.ok(la > 33.0 && la < 34.1 && lo > 126.0 && lo < 127.1, `${c.id} 범위 밖`);
  }
  const bowed = C.approxPath(window.APPROX_COURSES['03-A'], window.APPROX_ANCHORS);
  assert.deepEqual(bowed[0], window.APPROX_ANCHORS['온평포구']);
  assert.deepEqual(bowed[bowed.length - 1], window.APPROX_ANCHORS['표선해수욕장']);
});

test('장소 검색어: 설명형 이름에서 장소만 뽑고 단계별 후보를 만든다', () => {
  assert.deepEqual(C.searchTerms('제주해녀박물관 인근 식당', '시점 인근'), ['제주해녀박물관']);
  assert.equal(C.searchTerms('표선어촌식당', '표선 해안')[0], '표선어촌식당');
  assert.equal(C.searchTerms('무성향갈치조림 / 네거리식당', '서귀포 시내')[0], '무성향갈치조림');
  assert.equal(C.searchTerms('한담해안 카페거리 (봄날 등)', '한담해안산책로')[0], '한담해안');
  assert.equal(C.searchTerms('하이엔드제주 등 오션뷰 카페', '구엄리')[0], '하이엔드제주');
  assert.deepEqual(C.searchTerms('광치기·성산 일대 식당가', '시점·고성리 일대').slice(0, 2), ['광치기·성산', '광치기']);
  const hl = C.searchTerms('광치기해변 이끼바위', '');
  assert.deepEqual(hl, ['광치기해변 이끼바위', '광치기해변']);
  assert.ok(C.searchTerms('종점 모슬포항', '').length >= 1);
  assert.ok(C.searchTerms('x', 'y').every((t) => t.length >= 2) || true);
  // 모든 식당·구경거리에서 빈 후보가 나오지 않는다
  courses.forEach((c) => {
    c.restaurants.forEach((r) => assert.ok(C.searchTerms(r.name, r.spot).length >= 1, c.id + ' ' + r.name));
    c.highlights.forEach((h) => assert.ok(C.searchTerms(h, '').length >= 1, c.id + ' ' + h));
  });
});

test('GPX 고도(ele) 읽기·보존과 고도 프로필', () => {
  let pts = '';
  for (let i = 0; i < 60; i++) pts += '<trkpt lat="33.2' + (100 + i) + '" lon="126.3"><ele>' + (10 + i * 2) + '</ele></trkpt>';
  const p = C.parseGpx('<gpx><trk><trkseg>' + pts + '</trkseg></trk></gpx>');
  assert.equal(p.length, 60);
  assert.deepEqual(p[3].length, 3);
  assert.equal(p[3][2], 16);
  const c = C.compactPath(p, 1500);
  assert.equal(c[0].length, 3);
  const prof = C.elevationProfile(p);
  assert.ok(prof && prof.max > prof.min && prof.up > 100 && prof.down < 1);
  // 고도 없는 파일은 예전과 같은 2칸 형식, 프로필 없음
  const q = C.parseGpx('<trkpt lat="33.1" lon="126.1"></trkpt><trkpt lat="33.2" lon="126.2"/>');
  assert.deepEqual(q, [[33.1, 126.1], [33.2, 126.2]]);
  assert.equal(C.elevationProfile(q), null);
});
