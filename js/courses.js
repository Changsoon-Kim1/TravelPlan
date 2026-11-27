/* 올레 코스(고정 목록) + 내가 GPX로 추가한 코스(한라산 탐방로·오름·기타)
   추가 코스는 GPX를 올릴 때 이름과 종류를 정해 course_routes 에 함께 저장한다. */
(function () {
  'use strict';
  const BASE = window.OLLE_COURSES.slice();
  window.OLLE_BASE = BASE;

  const CATS = {
    halla: { icon: '⛰', label: '한라산', prefix: 'H' },
    oreum: { icon: '🌋', label: '오름', prefix: 'R' },
    etc: { icon: '🥾', label: '기타 코스', prefix: 'X' }
  };
  // 한라산 탐방로 이름 (GPX 파일 이름으로 종류를 짐작할 때와 이름 입력 추천에 사용)
  const HALLA_TRAILS = ['성판악', '관음사', '어리목', '영실', '돈내코', '어승생악', '석굴암'];

  function estHours(path) {
    const km = TPCore.pathLengthKm(path);
    const prof = TPCore.elevationProfile(path);
    const h = km / 3 + (prof ? prof.up / 500 : 0); // 평지 시속 3km + 오르막 500m당 1시간
    return Math.max(0.5, Math.round(h * 2) / 2);
  }

  function make(x, path) {
    const cat = CATS[x.category] || CATS.etc;
    const h = estHours(path);
    return {
      id: x.id, extra: true, category: x.category in CATS ? x.category : 'etc',
      code: cat.label, name: x.name || cat.label, icon: cat.icon,
      distance: TPCore.pathLengthKm(path), timeText: '약 ' + h + '시간 (GPX 기준 추정)', minHours: h, maxHours: h,
      difficulty: '', region: cat.label, isBranch: false, isIsland: false,
      start: '', end: '', highlights: [], features: '', waypoints: [], restaurants: [], tip: ''
    };
  }

  const TPCourses = {
    CATS, HALLA_TRAILS,
    base: () => BASE,
    isExtra: (c) => !!(c && c.extra),
    // 서버에서 받은 추가 코스 목록으로 전체 코스 목록을 다시 만든다 (경로가 있는 것만)
    setExtras(list, routes) {
      const extras = (list || []).filter((x) => x && x.id && routes[x.id] && routes[x.id].length > 1).map((x) => make(x, routes[x.id]));
      extras.sort((a, b) => (a.category === b.category ? a.name.localeCompare(b.name, 'ko') : (a.category < b.category ? -1 : 1)));
      window.OLLE_COURSES = BASE.concat(extras);
      return extras;
    },
    extras: () => window.OLLE_COURSES.filter((c) => c.extra),
    newId(category) {
      const p = (CATS[category] || CATS.etc).prefix;
      return p + Math.random().toString(36).slice(2, 8);
    },
    // 파일 이름으로 한라산/오름인지 짐작: { category, name } 또는 null
    guess(fileName) {
      const n = String(fileName).replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
      const t = HALLA_TRAILS.find((x) => n.includes(x));
      if (t || /한라산|hallasan|halla/i.test(n)) return { category: 'halla', name: t ? t + ' 탐방로' : n };
      const o = /([가-힣]{1,8}오름)/.exec(n);
      if (o) return { category: 'oreum', name: o[1] };
      return null;
    },
    // <select> 안의 코스 선택지 (올레 / 한라산 / 오름 / 기타로 묶음)
    optionsHTML(selected, withDist) {
      const esc = TPUtil.esc;
      const opt = (c) => '<option value="' + c.id + '"' + (c.id === selected ? ' selected' : '') + '>' +
        (c.extra ? c.icon + ' ' + esc(c.name) : esc(c.code) + ' ' + esc(c.name)) + (withDist ? ' · ' + c.distance.toFixed(1) + 'km' : '') + '</option>';
      let h = '<optgroup label="🥾 제주올레">' + BASE.map(opt).join('') + '</optgroup>';
      Object.keys(CATS).forEach((k) => {
        const list = window.OLLE_COURSES.filter((c) => c.extra && c.category === k);
        if (list.length) h += '<optgroup label="' + CATS[k].icon + ' ' + CATS[k].label + '">' + list.map(opt).join('') + '</optgroup>';
      });
      return h;
    },
    titleOf: (c) => (c.extra ? (c.category === 'halla' && !/한라산/.test(c.name) ? '한라산 ' : '') + c.name : c.code + ' ' + c.name)
  };
  window.TPCourses = TPCourses;
})();
