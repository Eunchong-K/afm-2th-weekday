require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const courses = [
  {
    city: '도쿄', country: '일본',
    name: '임피리얼 팰리스 런닝 코스',
    distance: '5',
    difficulty: '초급',
    description: '일본 황궁(皇居) 주변을 도는 도쿄의 대표 러닝 명소. 5km 평탄한 아스팔트 루프로 매일 수천 명의 러너가 모입니다. 해자와 성벽, 울창한 수목이 어우러진 클래식 코스.',
    map_url: 'https://maps.google.com/?q=Imperial+Palace+Running+Course+Tokyo',
  },
  {
    city: '파리', country: '프랑스',
    name: '카날 생마르탱 러닝 루트',
    distance: '9',
    difficulty: '초급',
    description: '파리 카날 생마르탱을 따라 바스티유까지 이어지는 낭만적인 9km 코스. 철제 아치 교량과 수문, 플라타너스 가로수가 계속 이어집니다. 현지 파리지앵 러너들이 가장 즐겨 찾는 루트.',
    map_url: 'https://maps.google.com/?q=Canal+Saint-Martin+Running+Paris',
  },
  {
    city: '뉴욕', country: '미국',
    name: '센트럴 파크 그레이트 루프',
    distance: '10',
    difficulty: '중급',
    description: '맨해튼 심장부 센트럴 파크를 일주하는 9.7km 상징적 코스. 1972년부터 뉴욕 마라톤 코스로 활용. 기복이 있어 훈련에 최적이며 스카이라인 뷰가 압도적입니다.',
    map_url: 'https://maps.google.com/?q=Central+Park+Great+Loop+New+York',
  },
  {
    city: '시드니', country: '호주',
    name: '본다이-쿠지 코스탈 워크',
    distance: '6',
    difficulty: '중급',
    description: '본다이 비치에서 쿠지 비치까지 태평양 해안 절벽을 달리는 6km 코스. 호주를 대표하는 시닉 러닝 루트로 절벽 뷰, 조각공원, 타마라마 비치 등을 통과합니다.',
    map_url: 'https://maps.google.com/?q=Bondi+to+Coogee+Coastal+Walk+Sydney',
  },
  {
    city: '런던', country: '영국',
    name: '하이드 파크 & 켄싱턴 가든 루프',
    distance: '6',
    difficulty: '초급',
    description: '런던 왕실 공원 하이드 파크와 켄싱턴 가든을 함께 도는 6km 루프. 서펜타인 호수, 피터팬 동상, 버킹엄 궁전 인근을 통과하는 런던 러너들의 성지.',
    map_url: 'https://maps.google.com/?q=Hyde+Park+Kensington+Gardens+Running+London',
  },
  {
    city: '바르셀로나', country: '스페인',
    name: '바르셀로네타-포르트 올림픽 코스',
    distance: '5',
    difficulty: '초급',
    description: '바르셀로나 해변 산책로를 따라 달리는 5km 지중해 코스. 바르셀로네타 비치에서 포르트 올림픽 마리나까지 이어지며 새벽 러닝에 최적의 환경. 기복 없는 평탄한 해변 코스.',
    map_url: 'https://maps.google.com/?q=Barceloneta+Port+Olympic+Running+Barcelona',
  },
  {
    city: '로마', country: '이탈리아',
    name: '빌라 보르게세 파크 러닝',
    distance: '7',
    difficulty: '중급',
    description: '로마 최대 공원 빌라 보르게세를 누비는 7km 코스. 핀치오 언덕 전망대에서 로마 시내 파노라마 뷰를 감상할 수 있으며 보르게세 미술관, 동물원 옆을 지납니다.',
    map_url: 'https://maps.google.com/?q=Villa+Borghese+Running+Rome',
  },
  {
    city: '방콕', country: '태국',
    name: '룸피니 파크 러닝 루프',
    distance: '2.5',
    difficulty: '초급',
    description: '방콕 도심 오아시스 룸피니 공원의 2.5km 루프. 새벽 5시부터 수천 명의 현지인이 함께 달리는 방콕 러닝 문화의 중심지. 반복 루프로 원하는 거리 자유 조절 가능.',
    map_url: 'https://maps.google.com/?q=Lumpini+Park+Running+Bangkok',
  },
  {
    city: '베를린', country: '독일',
    name: '티어가르텐 파크 런',
    distance: '7',
    difficulty: '초급',
    description: '베를린 중심부 티어가르텐 공원의 7km 코스. 브란덴부르크 문 근처에서 시작해 울창한 숲길과 지크스 벨레 기념비를 지나는 베를린 러너들의 필수 코스.',
    map_url: 'https://maps.google.com/?q=Tiergarten+Running+Berlin',
  },
  {
    city: '싱가포르', country: '싱가포르',
    name: '마리나 베이 워터프론트 런',
    distance: '7.5',
    difficulty: '중급',
    description: '마리나 베이를 따라 달리는 7.5km 야경 코스. 가든스 바이 더 베이, 마리나 베이 샌즈, 에스플러네이드를 지나는 세계 최고의 도심 야간 러닝 루트. 24시간 개방.',
    map_url: 'https://maps.google.com/?q=Marina+Bay+Waterfront+Running+Singapore',
  },
];

async function seed() {
  console.log('🌱 Seeding running courses...');
  for (const c of courses) {
    const today = new Date().toISOString().split('T')[0];
    await pool.query(
      `INSERT INTO marked_courses (user_id, user_name, city, country, name, distance, difficulty, description, map_url, image_url, date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [null, 'Marked 에디터', c.city, c.country, c.name, c.distance, c.difficulty, c.description, c.map_url, '', today]
    );
    console.log(`  ✅ ${c.city} — ${c.name}`);
  }
  await pool.end();
  console.log('Done!');
}

seed().catch(err => { console.error(err); process.exit(1); });
