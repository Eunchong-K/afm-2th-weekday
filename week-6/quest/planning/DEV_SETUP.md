# DEV_SETUP.md - Marked (마크드) 개발 셋업 가이드

> **앱**: Marked (마크드) — Leave your mark, Color your world.
> **Architecture**: Next.js 14 (App Router) + Supabase (DB/Auth/Storage)
> **개발 기간**: 2주 (1주차: 인프라 + 코스 등록, 2주차: 운동 기록 + 스탬프 카드)

---

## 1. 개발 아키텍처 선택 이유

세 가지 표준 옵션(Single-File / Supabase JS / Next.js) 중 **Next.js + Supabase 조합**이 확정되었습니다. 그 근거는 다음과 같습니다.

### Next.js를 선택한 이유
- **Google OAuth 콜백 처리**: App Router의 Route Handler(`app/auth/callback/route.ts`)로 Supabase Auth Helpers의 SSR 흐름을 안정적으로 처리할 수 있습니다.
- **SEO/공유 미리보기**: 인증샷 카드를 SNS에 공유하는 앱 특성상, 추후 OG 이미지/메타데이터를 풀어내려면 Next.js의 metadata API가 유리합니다.
- **Vercel 배포 최적화**: Vercel Hobby 플랜 무료 배포 + 빌드 캐시 + 자동 프리뷰 URL을 그대로 사용할 수 있습니다.
- **파일 기반 라우팅**: 화면 5개(홈/코스 목록/코스 등록/운동 기록/마이페이지)를 `app/` 디렉토리 구조에 1:1로 매핑하기에 직관적입니다.

### Supabase를 선택한 이유
- **Auth + DB + Storage 통합**: Google OAuth, PostgreSQL, 이미지 업로드(Storage 버킷)를 단일 SDK로 처리합니다.
- **RLS(Row Level Security)**: `places`, `workouts` 테이블에 user_id 기반 RLS만 걸어도 백엔드 인증 로직이 사실상 끝납니다.
- **html2canvas와의 호환성**: Supabase Storage 버킷의 CORS 설정만 풀어주면 `useCORS: true` 옵션으로 캔버스 캡처가 가능합니다.

### 왜 Single-File / Supabase JS-only가 아닌가
- **Single-File**: Google OAuth 콜백, 이미지 업로드, 환경변수 관리 등 인프라가 Next.js 수준의 안정성을 요구합니다.
- **Supabase JS-only (HTML/JS)**: 빌드 파이프라인 없이 html2canvas + Special Elite 폰트 로딩을 안정화하기 어렵고, Vercel 배포 시 환경변수 주입이 번거롭습니다.

---

## 2. 프로젝트 초기 세팅 명령어 순서

아래 순서대로 실행합니다. **반드시 1일차에 Vercel 배포까지 완료**해서 환경변수 이슈를 초기에 잡습니다.

### 2.1 Next.js 프로젝트 생성
```bash
# 프로젝트 루트로 이동
cd C:/Users/Chong/Downloads/ai-factory-manage/afm-2th-weekday/week-6/quest

# Next.js 14 + TypeScript + Tailwind + App Router로 생성
npx create-next-app@latest marked \
  --typescript \
  --tailwind \
  --app \
  --eslint \
  --src-dir=false \
  --import-alias="@/*"

cd marked
```

### 2.2 필수 패키지 설치
```bash
# Supabase
npm install @supabase/supabase-js @supabase/ssr

# 스탬프 카드 캡처
npm install html2canvas

# UI 유틸 (선택)
npm install clsx
```

### 2.3 환경변수 파일 생성
```bash
# .env.local 파일 생성 (아래 4번 섹션의 템플릿 복사)
touch .env.local

# .gitignore에 .env.local이 포함되어 있는지 확인 (Next.js 기본 포함됨)
```

### 2.4 Special Elite 폰트 적용
```bash
# app/layout.tsx에서 next/font/google로 임포트
# import { Special_Elite } from "next/font/google"
# const specialElite = Special_Elite({ weight: "400", subsets: ["latin"] })
```

### 2.5 Git 초기화 및 첫 푸시
```bash
git add .
git commit -m "chore: bootstrap Next.js + Tailwind + Supabase deps"
# GitHub repo 생성 후
git remote add origin <github-url>
git push -u origin main
```

### 2.6 Vercel 배포 (1일차 필수)
```bash
# Vercel CLI 사용 시
npm install -g vercel
vercel login
vercel link
vercel --prod

# 또는 vercel.com 대시보드에서 GitHub 연동 후 자동 배포
# 배포 완료 후 환경변수를 Vercel 대시보드에 등록 (Settings > Environment Variables)
```

### 2.7 로컬 개발 서버 실행
```bash
npm run dev
# http://localhost:3000 에서 확인
```

---

## 3. 외부 설정 필요 항목

### 3.1 Supabase 프로젝트 셋업

| 항목 | 설명 | 획득 방법 |
|------|------|----------|
| 프로젝트 생성 | Marked DB 호스팅 | [supabase.com](https://supabase.com) → New Project → Region: Northeast Asia (Seoul) |
| `NEXT_PUBLIC_SUPABASE_URL` | API 엔드포인트 | Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 클라이언트 공개 키 | Project Settings → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 사이드 관리자 키 (필요시) | Project Settings → API → service_role (절대 클라이언트 노출 금지) |

#### 테이블 생성 (SQL Editor에서 실행)
```sql
-- sport_types
create table sport_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon text not null,
  color text not null
);

insert into sport_types (name, icon, color)
values ('running', '🏃', '#FF6B35');

-- users (Supabase auth.users와 별도 프로필 테이블)
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nickname text,
  avatar_url text,
  created_at timestamptz default now()
);

-- places
create table places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sport_type_id uuid not null references sport_types(id),
  name text not null,
  country text not null,
  city text not null,
  address text not null,
  lat double precision,
  lng double precision,
  is_public boolean default false,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- workouts
create table workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  place_id uuid not null references places(id) on delete cascade,
  sport_type_id uuid not null references sport_types(id),
  distance_km numeric,
  duration_min integer,
  metadata jsonb default '{}',
  photo_url text,
  note text,
  workout_date date not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS 활성화
alter table places enable row level security;
alter table workouts enable row level security;
alter table users enable row level security;

-- RLS 정책: 본인 데이터만 조회/수정
create policy "places_owner_all" on places
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "workouts_owner_all" on workouts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "users_owner_all" on users
  for all using (auth.uid() = id) with check (auth.uid() = id);
```

#### Storage 버킷 생성
1. Supabase 대시보드 → Storage → New bucket
2. 버킷명: `workout-photos`
3. **Public bucket: ON** (인증샷 공유용)
4. **CORS 설정** (Storage → Configuration → CORS):
   ```json
   [
     {
       "origin": ["http://localhost:3000", "https://<your-vercel-domain>.vercel.app"],
       "method": ["GET", "POST", "PUT"],
       "headers": ["*"]
     }
   ]
   ```

---

### 3.2 Google OAuth 셋업

| 항목 | 설명 | 획득 방법 |
|------|------|----------|
| Google Cloud 프로젝트 | OAuth 동의 화면 호스팅 | [console.cloud.google.com](https://console.cloud.google.com) → New Project |
| OAuth Client ID/Secret | Google 로그인 자격 | APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application |

#### 콜백 URL 등록 (Authorized redirect URIs) — **둘 다 등록 필수**
```
https://<supabase-project>.supabase.co/auth/v1/callback
http://localhost:3000/auth/callback
https://<your-vercel-domain>.vercel.app/auth/callback
```

#### Supabase에 Google Provider 연결
1. Supabase 대시보드 → Authentication → Providers → Google
2. Enable Sign in with Google: ON
3. Client ID, Client Secret 입력
4. Authorized Client IDs 등록
5. Save

---

### 3.3 Vercel 배포 셋업

| 항목 | 설명 | 획득 방법 |
|------|------|----------|
| Vercel 계정 | 무료 Hobby 플랜 | [vercel.com](https://vercel.com) → GitHub 연동 |
| 프로젝트 import | GitHub repo 연결 | New Project → Import Git Repository |
| Production Domain | 배포 URL | Settings → Domains (자동 발급되는 `<project>.vercel.app` 사용 가능) |

#### Vercel 환경변수 등록
- Settings → Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 둘 다 등록
- Environment: Production, Preview, Development 모두 체크

---

## 4. 환경변수 목록 (.env.local 템플릿)

```bash
# ===== Supabase =====
# Supabase 대시보드 → Project Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...

# (선택) 서버 사이드 전용 — 절대 NEXT_PUBLIC 접두사 붙이지 말 것
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...

# ===== App Config =====
NEXT_PUBLIC_SITE_URL=http://localhost:3000
# 프로덕션에서는 Vercel 환경변수에 https://<your-domain>.vercel.app 로 덮어쓰기
```

> **주의**:
> - `NEXT_PUBLIC_` 접두사가 붙은 값은 클라이언트 번들에 포함됩니다 (anon key는 RLS로 보호되므로 OK).
> - `SUPABASE_SERVICE_ROLE_KEY`는 절대 클라이언트에 노출하지 마세요 — Server Component 또는 Route Handler에서만 사용.

---

## 5. 구체적 TODO 체크리스트

### Phase 1: 디자인 & 프로토타이핑 (Day 0 — 셋업 전 1일)

- [ ] 🟢 화면 5개의 와이어프레임을 `prototype-v1.html` 한 파일에 더미 데이터로 작성
  - 홈 / 코스 목록 / 코스 등록 / 운동 기록 / 마이페이지
  - Tailwind CDN + 더미 JSON으로 화면만 확인 (서버 불필요, 브라우저에서 직접 열기)
- [ ] 🟢 PassportStamp 컴포넌트의 시각 디자인 모킹 (Special Elite 폰트, 입국 도장 스타일)
- [ ] 🟢 WorkoutCard 인증샷 카드 레이아웃 모킹 (사진 + 도시 도장 + 거리/시간)

📌 **체크포인트**: 더미 데이터로 모든 화면이 보이고, 인증샷 카드와 도장 디자인이 결정됨 (브라우저에서 파일을 직접 열어 확인)
📌 **git commit**: "chore: add wireframe prototype"

---

### Phase 2: 1주차 — 기본 기능 + 인프라 셋업

#### Day 1: 프로젝트 초기화 + Vercel 배포 (인프라 이슈 조기 해결)
- [ ] 🟢 `npx create-next-app@latest marked` 로 프로젝트 생성
- [ ] 🟢 `@supabase/supabase-js`, `@supabase/ssr`, `html2canvas`, `clsx` 설치
- [ ] 🟢 Supabase 프로젝트 생성 (Region: Seoul)
- [ ] 🟢 `.env.local` 작성 + `lib/supabase/client.ts`, `lib/supabase/server.ts` 생성
- [ ] 🟢 GitHub repo 생성 후 첫 푸시
- [ ] 🟢 Vercel import + 환경변수 등록 + 첫 프로덕션 배포

📌 **체크포인트**: Vercel URL에서 기본 Next.js 페이지가 뜸, 환경변수 정상 주입 확인
📌 **git commit**: "chore: bootstrap project with Supabase env"

#### Day 2: DB 스키마 + Google OAuth
- [ ] 🟡 Supabase SQL Editor에서 `sport_types`, `users`, `places`, `workouts` 테이블 생성
- [ ] 🟡 `sport_types`에 running 시드 데이터 삽입
- [ ] 🟡 RLS 정책 설정 (places/workouts/users 본인 데이터만)
- [ ] 🟡 Storage 버킷 `workout-photos` 생성 + CORS 설정
- [ ] 🟡 Google Cloud Console에서 OAuth Client 생성 (콜백 URL 3개 등록: Supabase / localhost / Vercel)
- [ ] 🟡 Supabase Authentication → Providers → Google 활성화
- [ ] 🟡 `app/auth/callback/route.ts` 작성 — Supabase SSR 콜백 핸들러
- [ ] 🟡 `app/login/page.tsx` 작성 — Google 로그인 버튼

📌 **체크포인트**: 로컬 + Vercel 양쪽에서 Google 로그인 → users 테이블 row 생성까지 동작
📌 **git commit**: "feat: google oauth + db schema with rls"

#### Day 3: 공통 레이아웃 + 라우팅
- [ ] 🟢 `app/layout.tsx`에 Special Elite 폰트 적용 (`next/font/google`)
- [ ] 🟢 하단 탭 네비게이션 컴포넌트 (홈/코스/기록/마이페이지)
- [ ] 🟢 prototype-v1.html을 각 라우트로 분리: `app/page.tsx`(홈), `app/places/page.tsx`, `app/places/new/page.tsx`, `app/workouts/new/page.tsx`, `app/me/page.tsx`
- [ ] 🟢 인증 미들웨어(`middleware.ts`)로 비로그인 사용자 `/login` 리디렉션

📌 **체크포인트**: 로그인 후 5개 화면 사이를 네비게이션으로 이동 가능
📌 **git commit**: "feat: app router scaffolding + auth middleware"

#### Day 4: 코스 등록 폼
- [ ] 🟡 `app/places/new/page.tsx` — 코스명 / 나라 / 도시 / 주소 / 설명 입력 폼
- [ ] 🟡 Server Action 또는 Route Handler로 `places` 테이블 insert
- [ ] 🟢 입력 validation (필수값: name, country, city, address)
- [ ] 🟢 등록 성공 시 `/places`로 리디렉션 + toast

📌 **체크포인트**: 코스를 등록하면 Supabase places 테이블에 row가 들어가고 RLS로 본인 것만 보임

#### Day 5: 코스 목록 + 주소 복사 + 구글맵 이동
- [ ] 🟢 `app/places/page.tsx` — 본인이 등록한 코스 리스트 (나라/도시별 그룹)
- [ ] 🟢 코스 카드에 "주소 복사" 버튼 (`navigator.clipboard.writeText`)
- [ ] 🟢 "구글맵에서 보기" 버튼 (URL 스킴: `https://www.google.com/maps/search/?api=1&query=<encoded-address>`)
- [ ] 🟢 빈 상태(empty state) UI

📌 **체크포인트**: 등록한 코스 목록이 보이고, 주소 복사 + 구글맵 외부 이동 동작

#### Day 6: 홈 카운팅 + 1주차 마무리
- [ ] 🟡 `app/page.tsx` — 본인 places의 distinct 나라 수 / 도시 수 카운팅
- [ ] 🟡 최근 운동 기록 카드 placeholder (2주차에 실제 데이터 연결)
- [ ] 🟢 1주차 전체 동작 확인 + Vercel 재배포

📌 **체크포인트**: 홈에서 "🌍 N개국 / 🏙️ M개 도시" 카운트가 정확히 표시됨
📌 **git commit**: "feat: places CRUD + home counters (week 1 done)"

---

### Phase 2.5: 플랫폼 연결 검증 (Day 6 끝 ~ Day 7 시작)

- [ ] 🟡 Vercel Production 배포 환경에서 Google OAuth 로그인 → 코스 등록 → 목록 조회 전체 플로우 검증
- [ ] 🟡 Storage 버킷 CORS 검증 — Vercel 도메인에서 더미 이미지 업로드 테스트
- [ ] 🟡 모바일 브라우저(Safari iOS / Chrome Android)에서 실제 동작 확인

📌 **체크포인트**: 실제 프로덕션 환경 + 모바일에서 1주차 기능이 정상 동작. 어려운 기능(html2canvas)에 들어가기 전 인프라 이슈 zero.

---

### Phase 3: 2주차 — 핵심 & 어려운 기능 (불확실한 것부터)

#### Day 8 — 🔴 가장 불확실한 기능 먼저: html2canvas + Special Elite 폰트
- [ ] 🔴 PassportStamp 컴포넌트 구현 (Special Elite 폰트, 도시명 + 날짜)
  - ⚠️ 실패 시 우회: SVG 도장 이미지로 fallback
- [ ] 🔴 html2canvas 캡처 함수 구현 (`lib/captureCard.ts`)
  - ⚠️ **CORS 이슈**: Supabase Storage 버킷 CORS 재확인, `useCORS: true` 옵션 필수
  - ⚠️ **폰트 이슈**: 캡처 직전 `await document.fonts.load("16px 'Special Elite'")` + `await document.fonts.ready`
  - ⚠️ 실패 시 우회: 서버 사이드 캡처(playwright/puppeteer on Vercel function) — 단, 비용 부담 있음
- [ ] 🔴 캡처 결과를 PNG Blob으로 변환 → `<a download>` 또는 Web Share API

📌 **체크포인트**: 더미 사진 + 더미 도장으로 PNG 다운로드 + 공유까지 동작

#### Day 9: Storage 사진 업로드
- [ ] 🟡 `<input type="file" accept="image/*">` 사진 선택 UI
- [ ] 🟡 클라이언트에서 Supabase Storage `workout-photos` 버킷 업로드
- [ ] 🟡 Public URL을 `workouts.photo_url`에 저장
- [ ] 🟡 업로드 진행률 / 에러 처리

📌 **체크포인트**: 사진 업로드 → public URL 발급 → workouts 테이블 저장까지 동작

#### Day 10: 운동 기록 폼
- [ ] 🟡 `app/workouts/new/page.tsx` — 코스 선택(드롭다운, 본인 places) + 거리/시간/날짜/사진/메모 입력
- [ ] 🟡 sport_types에서 running fetch → `sport_type_id` 자동 세팅 (하드코딩 금지!)
- [ ] 🟡 등록 성공 시 인증샷 미리보기 화면으로 이동

📌 **체크포인트**: 운동 기록을 입력하면 workouts 테이블에 저장 + photo_url 연결

#### Day 11: WorkoutCard + 인증샷 생성 화면
- [ ] 🟡 `components/WorkoutCard.tsx` — 사진 배경 + 도시 도장 오버레이 + 거리/시간 텍스트
- [ ] 🟡 sport_types.icon, color를 동적으로 사용 (하드코딩 금지)
- [ ] 🟡 "PNG 저장" / "공유하기" 버튼 → Day 8의 캡처 함수 연결
- [ ] 🟡 Web Share API (`navigator.share`) — 미지원 브라우저는 다운로드 fallback

📌 **체크포인트**: 운동 기록 생성 → 인증샷 카드 생성 → 인스타에 공유 가능한 PNG 산출

#### Day 12: 마이페이지 + 홈 최근 기록 연결
- [ ] 🟡 `app/me/page.tsx` — 프로필(닉네임/아바타) + 운동 히스토리 리스트
- [ ] 🟡 닉네임 편집 모달
- [ ] 🟢 홈의 "최근 운동 기록 카드" placeholder를 실제 데이터로 교체 (workouts 최근 3개)

📌 **체크포인트**: 마이페이지에서 본인 모든 운동 기록을 시간순으로 확인 가능

---

### Phase 4: 마무리 & 배포 (Day 13~14)

- [ ] 🟡 빈 상태(empty state) / 로딩 / 에러 UI 폴리싱
- [ ] 🟡 Tailwind 디자인 통일성 점검 (color, spacing, font-weight)
- [ ] 🟡 모바일 뷰포트 최적화 (320px ~ 414px)
- [ ] 🟡 Lighthouse 점수 확인 (Performance, Accessibility)
- [ ] 🟡 Vercel 프로덕션 최종 배포
- [ ] 🟡 README에 데모 URL + 사용법 추가
- [ ] 🟡 친구/지인 베타 테스트 → 피드백 수집

📌 **체크포인트**: 실제 사용자가 가입 → 코스 등록 → 운동 기록 → 인증샷 SNS 공유까지 막힘없이 가능

---

## 6. 시작하기 (Quick Start)

```bash
# 1. 프로젝트 생성 (Day 1 첫 명령어)
cd C:/Users/Chong/Downloads/ai-factory-manage/afm-2th-weekday/week-6/quest
npx create-next-app@latest marked --typescript --tailwind --app --eslint --import-alias="@/*"
cd marked

# 2. 패키지 설치
npm install @supabase/supabase-js @supabase/ssr html2canvas clsx

# 3. 환경변수 설정
# .env.local 파일을 위 4번 섹션 템플릿대로 작성

# 4. 로컬 개발 서버 실행
npm run dev

# 5. 1일차 안에 Vercel 배포까지 완료할 것
vercel --prod
```

---

## 7. 알려진 함정 (반드시 미리 인지)

| 항목 | 문제 | 해결 |
|------|------|------|
| html2canvas CORS | Supabase Storage 이미지가 캔버스에 그려지지 않음 | 버킷 CORS 설정 + `useCORS: true` + `crossorigin="anonymous"` |
| Special Elite 폰트 | 캡처 시점에 폰트가 로드되지 않아 기본 폰트로 캡처됨 | 캡처 직전 `await document.fonts.ready` |
| Google OAuth 콜백 | Production 배포 후 redirect_uri_mismatch 에러 | 콜백 URL을 localhost / Vercel / Supabase 모두 등록 |
| Vercel 환경변수 | 로컬은 되는데 배포에서 환경변수 undefined | Vercel 대시보드에서 Production / Preview / Development 모두 체크 |
| sport_types 하드코딩 | v2에서 종목 추가 시 컴포넌트 전부 수정 필요 | DB에서 `icon`, `color` fetch해서 동적 사용 |
| RLS 누락 | 다른 사용자의 places가 보임 | 모든 테이블에 `enable row level security` + 본인 user_id 정책 |

---

## 8. v2 확장 대비 (현재는 nullable로만 두고 미구현)

- `places.lat / lng`: 추후 지도 SDK 연동 시 사용
- `places.is_public`: 추후 공개 코스 공유 기능 시 사용
- `workouts.metadata jsonb`: 추후 사이클/등산 등 종목별 추가 스탯
- `sport_types`: running 외 추가 시 시드만 더하면 됨
