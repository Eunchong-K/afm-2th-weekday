-- =============================================
-- 익명 게시판 Supabase 테이블 설정
-- Supabase Dashboard > SQL Editor 에서 실행하세요
-- =============================================

-- 1. posts 테이블
CREATE TABLE IF NOT EXISTS posts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  category      text        NOT NULL CHECK (category IN ('worry','compliment','cheer','poll')),
  content       text        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  tags          text[]      NOT NULL DEFAULT '{}',
  empathy_count integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 2. replies 테이블
CREATE TABLE IF NOT EXISTS replies (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  content    text        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. 인덱스 (정렬 성능 향상)
CREATE INDEX IF NOT EXISTS posts_created_at_idx    ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS posts_empathy_count_idx ON posts (empathy_count DESC);
CREATE INDEX IF NOT EXISTS replies_post_id_idx     ON replies (post_id, created_at ASC);

-- 4. 공감 원자적 증가 RPC 함수
CREATE OR REPLACE FUNCTION increment_empathy(post_id uuid)
RETURNS posts AS $$
  UPDATE posts
  SET empathy_count = empathy_count + 1
  WHERE id = post_id
  RETURNING *;
$$ LANGUAGE sql;

-- 5. RLS (Row Level Security) — 익명 읽기/쓰기 허용
ALTER TABLE posts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE replies ENABLE ROW LEVEL SECURITY;

-- posts: 전체 공개 읽기 + 익명 쓰기 허용
CREATE POLICY "posts_select_all"  ON posts FOR SELECT USING (true);
CREATE POLICY "posts_insert_anon" ON posts FOR INSERT WITH CHECK (true);
CREATE POLICY "posts_delete_anon" ON posts FOR DELETE USING (true);

-- replies: 전체 공개 읽기 + 익명 쓰기 허용
CREATE POLICY "replies_select_all"  ON replies FOR SELECT USING (true);
CREATE POLICY "replies_insert_anon" ON replies FOR INSERT WITH CHECK (true);
