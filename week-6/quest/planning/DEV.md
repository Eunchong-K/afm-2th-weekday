# DEV.md — 어떻게 만들 것인가?

> **참고 앱**: ShareAura (운동 인증샷), Polarsteps (여행 카운팅), 포토로그 (기록 일지)

---

## MVP 범위

| 기능 | 포함 여부 | 설명 |
|------|-----------|------|
| 러닝코스 직접 등록 | ✅ YES | 코스명 / 도시 / 나라 / 주소 수동 입력 |
| 주소 복사 & 구글맵 이동 | ✅ YES | 등록된 주소를 클립보드 복사 또는 구글맵 앱으로 열기 |
| 운동 기록 입력 | ✅ YES | 거리(km) / 시간(분) / 날짜 / 사진 업로드 |
| 스탬프 인증샷 카드 | ✅ YES | 사진 위에 도시 스탬프 + 운동 스탯 합성 → PNG 저장 / SNS 공유 |
| 홈 — 나라 & 도시 카운팅 | ✅ YES | 내가 뛴 나라 수 / 도시 수 자동 집계 |
| 클라이밍 / 다른 운동 | ❌ v2 | 스키마는 확장 가능하게 설계, 기능은 추후 추가 |
| 지도 시각화 | ❌ v2 | 홈 카운팅으로 대체 |
| 유저 리뷰 / 제보 | ❌ v2 | 먼저 내 기록 쌓기에 집중 |
| GPX 파일 업로드 | ❌ v2 | 수동 입력으로 시작 |
| 달력 뷰 | ❌ v2 | 홈 카드 리스트로 대체 |

---

## 화면 구성 (5개)

```
① 홈          — 나라/도시 카운팅 + 최근 운동 기록 카드 리스트
② 코스 목록   — 내가 등록한 러닝코스 목록 + 검색
③ 코스 등록   — 코스명 / 나라 / 도시 / 주소 입력 폼
④ 운동 기록   — 코스 선택 + 거리/시간/사진 입력 → 스탬프 카드 생성
⑤ 마이페이지  — 프로필 + 전체 기록 히스토리
```

---

## DB 스키마

### `sport_types` — 운동 종류 (확장 가능)

```sql
sport_types (
  id        uuid PRIMARY KEY,
  name      text,   -- 'running' | 향후 'climbing' | 'cycling' 등
  icon      text,   -- '🏃'
  color     text    -- '#FF6B35'
)
-- 초기 시딩: running 1개만
```

### `users`

```sql
users (
  id          uuid PRIMARY KEY,  -- Supabase Auth uid
  email       text,
  nickname    text,
  avatar_url  text
)
```

### `places` — 러닝코스 (유저가 직접 등록)

```sql
places (
  id             uuid PRIMARY KEY,
  user_id        uuid REFERENCES users,
  sport_type_id  uuid REFERENCES sport_types,
  name           text,         -- 코스명 (예: 해운대 수변로)
  country        text,         -- 나라 (예: 대한민국)
  city           text,         -- 도시 (예: 부산)
  address        text,         -- 주소 (구글맵 링크 생성에 사용)
  lat            numeric,      -- nullable, 지도 v2 대비
  lng            numeric,      -- nullable, 지도 v2 대비
  is_public      boolean default false,  -- 공개 코스 공유 v2 대비
  description    text,         -- 간단한 메모 (선택)
  created_at     timestamptz,
  updated_at     timestamptz default now()
)
```

### `workouts` — 운동 기록

```sql
workouts (
  id              uuid PRIMARY KEY,
  user_id         uuid REFERENCES users,
  place_id        uuid REFERENCES places,
  sport_type_id   uuid REFERENCES sport_types,
  distance_km     numeric,      -- 러닝 기준. 다른 종목은 nullable
  duration_min    integer,
  metadata        jsonb,        -- 종목별 추가 스탯 (러닝: {"pace":"5'38\""} | 클라이밍: {"routes":5,"grade":"V4"})
  photo_url       text,         -- 원본 사진 (Supabase Storage)
  note            text,
  workout_date    date,
  created_at      timestamptz,
  updated_at      timestamptz default now()
)
```

> **확장 전략**: 나중에 클라이밍을 추가하면 `sport_types`에 row 1개 INSERT, `places`와 `workouts`는 `sport_type_id`로 필터링. 스키마 변경 없음.
>
> **컴포넌트 주의**: `PassportStamp`와 `WorkoutCard`에서 활동 아이콘을 하드코딩하지 말 것.
> `sport_types.icon` 값을 props로 받아서 렌더링해야 v2에서 종목 추가 시 컴포넌트 수정이 불필요.
> ```tsx
> // ❌ <span>🏃</span>
> // ✅ <span>{sportType.icon}</span>
> ```

---

## 스탬프 카드 디자인 (ShareAura 스타일)

```
┌─────────────────────────────┐
│                             │
│        [사진 배경]           │
│                             │
│  ┌──────────────┐           │
│  │ 🏃  BUSAN   │  ← 스탬프  │
│  │ 2026.04.27  │           │
│  │  KOREA      │           │
│  └──────────────┘           │
│                             │
│  10.4 km  ┃  58:32         │
│  ─────────────────────────  │
│  M A R K E D               │
└─────────────────────────────┘
```

- 배경: `workouts.photo_url`
- 스탬프: 도시명 + 날짜 + 나라 (SVG 컴포넌트)
- 스탯: 거리 / 시간 (러닝 기록에서 자동)
- 카드는 **온디맨드 생성** — 운동 상세 페이지 진입 시 렌더링, Storage 저장 없음
- [저장] `html2canvas` → PNG 다운로드 / [공유] Web Share API

---

## 구글맵 이동 & 주소 복사

별도 지도 SDK 없이 URL 스킴만 사용합니다.

```js
// 구글맵으로 이동 (주소 기반)
const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
window.open(mapsUrl, '_blank')

// 주소 클립보드 복사
navigator.clipboard.writeText(address)
```

---

## 기술 스택

| 레이어 | 기술 | 비고 |
|--------|------|------|
| Frontend | Next.js 14 (App Router) | |
| DB / Storage / Auth | Supabase | 무료 티어 충분 |
| 인증 | Google OAuth (Supabase Auth) | |
| 스탬프 카드 합성 | `html2canvas` | 무료 오픈소스 |
| SNS 공유 | Web Share API | 브라우저 내장, 무료 |
| 스타일링 | Tailwind CSS | |
| 폰트 (스탬프) | Google Fonts — Special Elite | 무료 |
| 배포 | Vercel Hobby | 무료 |

> 지도 SDK 없음. 구글맵은 URL 스킴으로 연결.

---

## 주차별 체크리스트

### 7주차 — 기반 세팅 & 코스 등록

- [ ] Supabase 프로젝트 생성
- [ ] DB 스키마 생성 (`sport_types` 시딩: running 1개)
- [ ] Google OAuth 로그인 (Supabase Auth)
- [ ] 홈 화면 — 나라 수 / 도시 수 카운팅 + 최근 운동 기록 카드
- [ ] 코스 등록 폼 — 코스명 / 나라 / 도시 / 주소 입력
- [ ] 코스 목록 페이지 — 내 코스 리스트
- [ ] 코스 상세 — 주소 복사 버튼 + 구글맵으로 이동 버튼

### 8주차 — 운동 기록 & 스탬프 카드

- [ ] 운동 기록 폼 — 코스 선택 + 거리 / 시간 / 날짜 / 사진 업로드
- [ ] `PassportStamp` 컴포넌트 — SVG 톱니 테두리 + 도시명 + 날짜 + 나라
  - 폰트: Special Elite, 기울기 seed 고정, 잉크 번짐 CSS
- [ ] `WorkoutCard` 컴포넌트 — 사진 배경 + 스탬프 + 스탯
- [ ] 운동 상세 페이지에서 `WorkoutCard` 온디맨드 렌더링
- [ ] [저장] 버튼 → `html2canvas` → PNG 다운로드
- [ ] [공유] 버튼 → Web Share API
- [ ] 마이페이지 — 전체 운동 기록 히스토리

### 데모데이까지 — 마무리

- [ ] 반응형 UI (모바일 우선)
- [ ] 샘플 데이터 입력 (코스 3개, 운동 기록 5개)
- [ ] Vercel 배포 + 환경변수 설정
- [ ] 데모 시나리오 (로그인 → 코스 등록 → 운동 기록 → 스탬프 카드 생성 & 공유 → 홈 카운팅 확인)
- [ ] README 작성
