# Marked — Leave your mark, Color your world.

세계 어디서든 달린 기록을 남기고, 나라별 러닝 코스를 탐색하는 러닝 기록 앱.

**Live Demo**: https://project-sand-theta-93.vercel.app

---

## 사용법

### 로컬 실행

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 설정 (.env)
DATABASE_URL=postgresql://...   # Supabase 또는 PostgreSQL 연결 문자열
SECRET_KEY=your-secret-key      # 비밀번호 해싱용 시크릿 (임의 문자열)
PORT=3000                       # 선택 (기본값 3000)

# 3. 서버 실행
npm start
# → http://localhost:3000

# 4. (선택) 샘플 러닝 코스 데이터 삽입
node seed-courses.js
```

### Vercel 배포

1. [Vercel](https://vercel.com)에서 이 레포를 import
2. **Environment Variables** 에 아래 값 추가:
   - `DATABASE_URL` — Supabase PostgreSQL 연결 문자열
   - `SECRET_KEY` — 비밀번호 해싱용 시크릿 키 (임의의 안전한 문자열)
   - `ORIGIN` — 배포된 Vercel URL (예: `https://marked-app.vercel.app`)
3. Deploy

> **주의**: Vercel 서버리스 환경에서는 파일 업로드(`/uploads`)가 영구 저장되지 않습니다.  
> 코스 이미지는 ImageKit·S3 등 외부 스토리지 연동을 권장합니다.

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 러닝 기록 | 도시·거리·시간·메모 입력, 페이스 자동 계산 |
| 스탬프 생성 | 5가지 템플릿으로 SNS 공유용 카드 제작 |
| 글로벌 지구본 | 달린 나라를 D3.js 지구본으로 시각화 |
| 러닝 코스 탐색 | 세계 도시별 추천 코스 + 해당 도시 러너 기록 |

---

## 기술 스택

- **Frontend**: React 18 (CDN), Tailwind CSS, D3.js
- **Backend**: Express.js, Node.js
- **DB**: PostgreSQL (Supabase)
- **Deploy**: Vercel
