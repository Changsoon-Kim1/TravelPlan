// 사용법: node tools/build_courses.mjs <제주올레_가이드.html> > data/courses.js
// 가이드 HTML 안의 OLLE_COURSES 배열을 꺼내 앱용 데이터 파일로 변환한다.
import fs from 'node:fs';

const src = fs.readFileSync(process.argv[2], 'utf8');
const start = src.indexOf('const OLLE_COURSES = [');
if (start < 0) throw new Error('OLLE_COURSES 를 찾지 못했습니다');
const end = src.indexOf('\n    ];', start);
const literal = src.slice(start + 'const OLLE_COURSES = '.length, end + 7).replace(/;\s*$/, '');
const courses = new Function('return ' + literal)();

const springMatch = src.match(/id: 'spring'[\s\S]*?includes\(c\.id\)/);
const spring = springMatch ? [...springMatch[0].matchAll(/'([0-9A-B-]+)'/g)].map((m) => m[1]).filter((x) => /^\d/.test(x)) : [];

const keep = courses.map((c) => ({
  id: c.id, code: c.code, name: c.name, start: c.start, end: c.end,
  distance: c.distance, timeText: c.timeText, minHours: c.minHours, maxHours: c.maxHours,
  difficulty: c.difficulty, region: c.region, isBranch: c.isBranch, isIsland: c.isIsland,
  wheelchair: c.wheelchair, sceneryLabel: c.sceneryLabel, terrainBadge: c.terrainBadge,
  highlights: c.highlights, features: c.features, waypoints: c.waypoints,
  restaurants: c.restaurants, tip: c.tip,
}));

process.stdout.write(
  '// 자동 생성 파일 (tools/build_courses.mjs). 원본: 제주 올레길 27코스 완벽 선택 가이드\n' +
  'window.OLLE_COURSES = ' + JSON.stringify(keep, null, 1) + ';\n' +
  'window.OLLE_SPRING_IDS = ' + JSON.stringify(spring) + ';\n');
