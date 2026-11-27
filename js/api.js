/* Supabase 연동: 소유자(로그인) / 게스트(공유 링크) 두 가지 방식을 같은 인터페이스로 제공 */
(function () {
  'use strict';
  const CFG = window.TP_CONFIG;
  const LS_SESSION = 'tp_session', LS_TOKEN = 'tp_share_token', LS_TRIP = 'tp_trip_id';

  let session = null;       // { access_token, refresh_token, expires_at, email }
  let mode = 'none';        // 'owner' | 'guest' | 'none'
  let shareToken = null;
  let trip = null;
  let trips = [];
  let onAuthLost = function () {};

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 불가 환경 */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } }
  const now = () => Math.floor(Date.now() / 1000);

  const ERR_KO = {
    invalid_token: '공유 링크가 올바르지 않거나, 공유가 꺼져 있습니다.',
    read_only: '읽기 전용 링크라서 수정할 수 없습니다.',
    too_many_events: '일정이 너무 많습니다 (최대 500개).',
    not_found: '이미 삭제되었거나 찾을 수 없는 일정입니다.'
  };
  class ApiError extends Error {
    constructor(message, status, code) { super(ERR_KO[message] || message); this.status = status; this.code = code; this.raw = message; }
  }

  async function authRequest(grant, body) {
    let r;
    try {
      r = await fetch(CFG.SUPABASE_URL + '/auth/v1/token?grant_type=' + grant, {
        method: 'POST', headers: { apikey: CFG.SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
    } catch (e) { throw new ApiError('서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.', 0); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j.error_description || j.msg || j.message || ('로그인 실패 (' + r.status + ')');
      throw new ApiError(/invalid login/i.test(msg) ? '이메일 또는 비밀번호가 올바르지 않습니다.' : msg, r.status);
    }
    return j;
  }
  function saveSession(j) {
    session = {
      access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: now() + (j.expires_in || 3600), email: (j.user && j.user.email) || (session && session.email) || ''
    };
    lsSet(LS_SESSION, JSON.stringify(session));
  }
  function dropSession() { session = null; lsDel(LS_SESSION); }

  async function ensureFresh() {
    if (!session) throw new ApiError('로그인이 필요합니다.', 401);
    if (session.expires_at - 60 > now()) return;
    try {
      saveSession(await authRequest('refresh_token', { refresh_token: session.refresh_token }));
    } catch (e) {
      if (e.status === 400 || e.status === 401 || e.status === 403) { dropSession(); mode = 'none'; onAuthLost(); }
      throw e;
    }
  }

  async function rest(path, opts) {
    opts = opts || {};
    const auth = opts.auth !== false;
    const headers = Object.assign({ apikey: CFG.SUPABASE_KEY, 'Content-Type': 'application/json' }, opts.headers || {});
    if (auth) { await ensureFresh(); headers.Authorization = 'Bearer ' + session.access_token; }
    let r;
    try {
      r = await fetch(CFG.SUPABASE_URL + '/rest/v1/' + path, {
        method: opts.method || 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      });
    } catch (e) { throw new ApiError('서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.', 0); }
    const text = await r.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
    if (!r.ok) throw new ApiError((data && (data.message || data.error)) || ('요청 실패 (' + r.status + ')'), r.status, data && data.code);
    return data;
  }
  const rpc = (fn, args) => rest('rpc/' + fn, { method: 'POST', body: args, auth: false });

  function normEvent(e) {
    return {
      id: e.id, day: e.day, end_day: e.end_day || null,
      start_time: TPCore.normTime(e.start_time), end_time: TPCore.normTime(e.end_time),
      title: e.title, kind: e.kind || 'other', course_id: e.course_id || null, note: e.note || '',
      place: e.place || '', lat: e.lat == null ? null : Number(e.lat), lng: e.lng == null ? null : Number(e.lng),
      created_by: e.created_by || 'owner'
    };
  }
  function normPlace(p) {
    return { id: p.id, name: p.name, addr: p.addr || '', lat: Number(p.lat), lng: Number(p.lng), created_by: p.created_by || 'owner' };
  }
  function eventPayload(ev) {
    return {
      day: ev.day, end_day: ev.end_day || null,
      start_time: ev.start_time || null, end_time: ev.end_time || null,
      title: ev.title, kind: ev.kind || 'other', course_id: ev.course_id || null, note: ev.note || null,
      place: ev.place || null, lat: ev.lat == null ? null : ev.lat, lng: ev.lng == null ? null : ev.lng
    };
  }
  function normTrip(t) {
    return Object.assign({}, t, {
      mode: t.mode === 'general' ? 'general' : 'olle',
      map_lat: t.map_lat == null ? null : Number(t.map_lat), map_lng: t.map_lng == null ? null : Number(t.map_lng),
      map_zoom: t.map_zoom == null ? null : Number(t.map_zoom)
    });
  }
  function randomToken() {
    const a = new Uint8Array(24);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  const Data = {
    setAuthLostHandler(fn) { onAuthLost = fn; },
    mode: () => mode,
    email: () => (session && session.email) || '',
    trip: () => trip,
    canEdit: () => mode === 'owner' || (mode === 'guest' && !!(trip && trip.can_edit)),
    isOwner: () => mode === 'owner',

    /** 앱 시작 시 호출: 저장된 로그인/공유 토큰으로 접속 방식을 정한다 */
    async init() {
      const urlToken = new URLSearchParams(location.search).get('t');
      if (urlToken) lsSet(LS_TOKEN, urlToken);
      shareToken = urlToken || lsGet(LS_TOKEN);
      const saved = lsGet(LS_SESSION);
      if (saved) {
        try {
          session = JSON.parse(saved);
          await ensureFresh();
          mode = 'owner';
          return mode;
        } catch (e) {
          if (e.status === undefined) dropSession();          // 저장된 값이 깨진 경우
          else if (e.status === 0 && session) { mode = 'owner'; return mode; } // 오프라인: 로그인은 유지
        }
      }
      mode = shareToken ? 'guest' : 'none';
      return mode;
    },
    async login(email, password) {
      saveSession(await authRequest('password', { email, password }));
      mode = 'owner';
    },
    logout() { dropSession(); mode = shareToken ? 'guest' : 'none'; trip = null; },
    forgetShareToken() { lsDel(LS_TOKEN); shareToken = null; },

    shareLink() {
      if (!trip || !trip.share_token) return '';
      return location.origin + location.pathname + '?t=' + trip.share_token;
    },

    /** 여행 정보 + 일정 + 코스 경로를 한 번에 읽는다 */
    async loadAll() {
      if (mode === 'guest') {
        const bundle = await rpc('shared_bundle', { p_token: shareToken });
        if (!bundle) { throw new ApiError('invalid_token', 400); }
        trip = normTrip(bundle.trip);
        const routes = trip.mode === 'olle' ? ((await rpc('shared_routes', { p_token: shareToken })) || {}) : {};
        let extras = [];
        if (trip.mode === 'olle') { try { extras = (await rpc('shared_course_meta', { p_token: shareToken })) || []; } catch (e) { extras = []; } }
        return { trip, events: (bundle.events || []).map(normEvent), routes, extras, places: (bundle.places || []).map(normPlace) };
      }
      if (mode !== 'owner') throw new ApiError('로그인이 필요합니다.', 401);
      const list = (await rest('trips?select=*&order=start_date.asc&limit=200')).map(normTrip);
      trips = list;
      if (!list.length) { trip = null; return { trip: null, trips: list, events: [], routes: {}, extras: [], places: [] }; }
      const want = lsGet(LS_TRIP);
      trip = Object.assign({}, list.find((t) => t.id === want) || list[0], { can_edit: true });
      lsSet(LS_TRIP, trip.id);
      const [evs, rts, pls] = await Promise.all([
        rest('trip_events?trip_id=eq.' + trip.id + '&select=*&order=day.asc&limit=1000'),
        trip.mode === 'olle' ? rest('course_routes?select=course_id,path,name,category') : Promise.resolve([]),
        rest('trip_places?trip_id=eq.' + trip.id + '&select=*&order=created_at.asc&limit=500')
      ]);
      const routes = {};
      const extras = [];
      rts.forEach((r) => { routes[r.course_id] = r.path; if (r.category) extras.push({ id: r.course_id, name: r.name, category: r.category }); });
      return { trip, trips: list, events: evs.map(normEvent), routes, extras, places: pls.map(normPlace) };
    },

    // ---- 여행 목록 (소유자) ----
    tripList: () => trips.slice(),
    selectTrip(id) { lsSet(LS_TRIP, id); },
    async createTrip(f) {
      const rows = await rest('trips', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: {
          title: f.title, start_date: f.start_date, end_date: f.end_date, mode: f.mode === 'general' ? 'general' : 'olle',
          map_lat: f.map_lat == null ? null : f.map_lat, map_lng: f.map_lng == null ? null : f.map_lng, map_zoom: f.map_zoom == null ? null : f.map_zoom
        }
      });
      return normTrip(rows[0]);
    },
    async patchTrip(id, patch) {
      const rows = await rest('trips?id=eq.' + id, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: patch });
      return normTrip(rows[0]);
    },
    async deleteTrip(id) {
      await rest('trips?id=eq.' + id, { method: 'DELETE' });
      if (lsGet(LS_TRIP) === id) lsDel(LS_TRIP);
    },

    async saveEvent(ev) {
      const payload = eventPayload(ev);
      if (mode === 'guest') {
        const row = await rpc('shared_event_save', { p_token: shareToken, p_event: Object.assign({ id: ev.id || null }, payload) });
        return normEvent(row);
      }
      if (ev.id) {
        const rows = await rest('trip_events?id=eq.' + encodeURIComponent(ev.id), { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: payload });
        if (!rows.length) throw new ApiError('not_found', 404);
        return normEvent(rows[0]);
      }
      const rows = await rest('trip_events', { method: 'POST', headers: { Prefer: 'return=representation' }, body: Object.assign({ trip_id: trip.id }, payload) });
      return normEvent(rows[0]);
    },
    async savePlace(pl) {
      const body = { name: pl.name, addr: pl.addr || null, lat: pl.lat, lng: pl.lng };
      if (mode === 'guest') return normPlace(await rpc('shared_place_save', { p_token: shareToken, p_place: body }));
      const rows = await rest('trip_places', { method: 'POST', headers: { Prefer: 'return=representation' }, body: Object.assign({ trip_id: trip.id }, body) });
      return normPlace(rows[0]);
    },
    async deletePlace(id) {
      if (mode === 'guest') { await rpc('shared_place_delete', { p_token: shareToken, p_id: id }); return; }
      await rest('trip_places?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
    },
    async deleteEvent(id) {
      if (mode === 'guest') { await rpc('shared_event_delete', { p_token: shareToken, p_id: id }); return; }
      await rest('trip_events?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
    },

    // ---- 소유자 전용 ----
    // meta: { courseId: { name, category } } — 한라산·오름 등 내가 추가하는 코스만
    async saveRoutes(map, meta) {
      meta = meta || {};
      const body = Object.keys(map).map((cid) => ({ course_id: cid, path: map[cid], point_count: map[cid].length,
        name: meta[cid] ? meta[cid].name : null, category: meta[cid] ? meta[cid].category : null }));
      if (!body.length) return;
      await rest('course_routes?on_conflict=owner_id,course_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body });
    },
    async deleteRoute(courseId) {
      await rest('course_routes?course_id=eq.' + encodeURIComponent(courseId), { method: 'DELETE' });
    },
    async updateTrip(patch) {
      const rows = await rest('trips?id=eq.' + trip.id, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: patch });
      trip = Object.assign({}, trip, normTrip(rows[0]), { can_edit: true });
      return trip;
    },
    async rotateShareToken() { return Data.updateTrip({ share_token: randomToken() }); }
  };

  window.TPData = Data;
  window.TPApiError = ApiError;
})();
