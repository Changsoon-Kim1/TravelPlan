// Supabase 접속 정보. publishable 키는 공개되어도 되는 키이며,
// 데이터는 서버의 접근 규칙(RLS + 공유 토큰 RPC)으로 보호됩니다.
window.TP_CONFIG = {
  SUPABASE_URL: 'https://xwwzpnupshogplebfhgi.supabase.co',
  SUPABASE_KEY: 'sb_publishable_BW5GuIdiVJQNEshgsrRBQQ_ejTH57mL',

  TRIP_TITLE: '2027 4월 제주 올레길 여행',
  TRIP_START: '2027-04-11',
  TRIP_END: '2027-04-19',

  // 처음 로그인했을 때 한 번만 넣는 기본 일정 (이후 자유롭게 수정/삭제 가능)
  SEED_EVENTS: [
    { day: '2027-04-11', start_time: '11:20', end_time: null, kind: 'flight', title: '김포 → 제주 (11:20 출발)', note: '김포공항 출발' },
    { day: '2027-04-14', end_day: '2027-04-15', start_time: null, end_time: null, kind: 'stay', title: '제주 신라호텔 (2박)', note: '4/16 체크아웃' },
    { day: '2027-04-19', start_time: '15:30', end_time: null, kind: 'flight', title: '제주 → 김포 (15:30 출발)', note: '김포공항 도착' }
  ]
};
