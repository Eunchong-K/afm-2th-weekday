require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3004;

// ── PostgreSQL 연결 ───────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── DB 테이블 초기화 ──────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id            TEXT        PRIMARY KEY,
      category      TEXT        NOT NULL CHECK (category IN ('worry','compliment','cheer','poll')),
      content       TEXT        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
      tags          TEXT[]      NOT NULL DEFAULT '{}',
      empathy_count INTEGER     NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS replies (
      id         TEXT        PRIMARY KEY,
      post_id    TEXT        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      content    TEXT        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS posts_created_at_idx    ON posts (created_at DESC);
    CREATE INDEX IF NOT EXISTS posts_empathy_count_idx ON posts (empathy_count DESC);
    CREATE INDEX IF NOT EXISTS replies_post_id_idx     ON replies (post_id, created_at ASC);
  `);
}

// ── 헬퍼 ─────────────────────────────────────────────────
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const VALID_CATEGORIES = ['worry', 'compliment', 'cheer', 'poll'];

function validatePost({ category, content, tags }) {
  if (!category || !VALID_CATEGORIES.includes(category))
    return 'category는 worry, compliment, cheer, poll 중 하나여야 합니다';
  if (!content || content.trim().length < 1 || content.trim().length > 500)
    return 'content는 1~500자 사이여야 합니다';
  if (tags !== undefined && (!Array.isArray(tags) || tags.length > 5))
    return 'tags는 최대 5개까지 가능합니다';
  return null;
}

function validateReply({ content }) {
  if (!content || content.trim().length < 1 || content.trim().length > 200)
    return 'content는 1~200자 사이여야 합니다';
  return null;
}

// ── 미들웨어 ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── 게시글 API ────────────────────────────────────────────

// GET /api/posts?sort=latest|empathy&category=...
app.get('/api/posts', async (req, res) => {
  try {
    const { sort = 'latest', category } = req.query;
    const orderBy = sort === 'empathy' ? 'p.empathy_count DESC' : 'p.created_at DESC';

    const params = [];
    let where = '';
    if (category && VALID_CATEGORIES.includes(category)) {
      params.push(category);
      where = `WHERE p.category = $${params.length}`;
    }

    const { rows } = await pool.query(`
      SELECT p.*,
             (SELECT COUNT(*)::int FROM replies r WHERE r.post_id = p.id) AS reply_count
      FROM posts p
      ${where}
      ORDER BY ${orderBy}
    `, params);

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/posts
app.post('/api/posts', async (req, res) => {
  try {
    const err = validatePost(req.body);
    if (err) return res.status(400).json({ success: false, message: err });

    const { category, content, tags = [] } = req.body;
    const id = generateId();

    await pool.query(
      'INSERT INTO posts (id, category, content, tags) VALUES ($1, $2, $3, $4)',
      [id, category, content.trim(), tags]
    );

    const { rows } = await pool.query(
      'SELECT *, 0 AS reply_count FROM posts WHERE id = $1', [id]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/posts/:id
app.patch('/api/posts/:id', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다' });

    const { content, tags } = req.body;
    if (content !== undefined && (content.trim().length < 1 || content.trim().length > 500))
      return res.status(400).json({ success: false, message: 'content는 1~500자 사이여야 합니다' });
    if (tags !== undefined && (!Array.isArray(tags) || tags.length > 5))
      return res.status(400).json({ success: false, message: 'tags는 최대 5개까지 가능합니다' });

    await pool.query(
      'UPDATE posts SET content = $1, tags = $2 WHERE id = $3',
      [
        content !== undefined ? content.trim() : existing[0].content,
        tags !== undefined ? tags : existing[0].tags,
        req.params.id
      ]
    );

    const { rows } = await pool.query(`
      SELECT p.*, (SELECT COUNT(*)::int FROM replies r WHERE r.post_id = p.id) AS reply_count
      FROM posts p WHERE p.id = $1
    `, [req.params.id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/posts/:id
app.delete('/api/posts/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM posts WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다' });
    await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]);
    res.json({ success: true, data: null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 공감 API ──────────────────────────────────────────────

// POST /api/posts/:id/empathy
app.post('/api/posts/:id/empathy', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM posts WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다' });

    const { rows: updated } = await pool.query(
      'UPDATE posts SET empathy_count = empathy_count + 1 WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    res.json({ success: true, data: updated[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 답글 API ──────────────────────────────────────────────

// GET /api/posts/:id/replies
app.get('/api/posts/:id/replies', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM replies WHERE post_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/posts/:id/replies
app.post('/api/posts/:id/replies', async (req, res) => {
  try {
    const err = validateReply(req.body);
    if (err) return res.status(400).json({ success: false, message: err });

    const { rows: post } = await pool.query('SELECT id FROM posts WHERE id = $1', [req.params.id]);
    if (!post[0]) return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다' });

    const id = generateId();
    await pool.query(
      'INSERT INTO replies (id, post_id, content) VALUES ($1, $2, $3)',
      [id, req.params.id, req.body.content.trim()]
    );

    const { rows } = await pool.query('SELECT * FROM replies WHERE id = $1', [id]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Fallback ──────────────────────────────────────────────
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── 시작 ──────────────────────────────────────────────────
if (require.main === module) {
  initDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`📋 익명 게시판 서버 실행 중 → http://localhost:${PORT}`);
        console.log(`🗄️  DB: Supabase PostgreSQL`);
      });
    })
    .catch(err => {
      console.error('DB 초기화 실패:', err.message);
      process.exit(1);
    });
}
module.exports = app;
