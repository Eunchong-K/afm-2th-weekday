require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const bcrypt     = require('bcrypt');
const jwt        = require('jsonwebtoken');
const { Pool }   = require('pg');

const app  = express();
const PORT = process.env.PORT || 3005;

// ── Config ──────────────────────────────────────────────
const JWT_SECRET    = process.env.JWT_SECRET || 'community-secret-2025';
const DATABASE_URL  = process.env.DATABASE_URL
  || 'postgresql://postgres.ewmsfpljitindhwddgsk:13mPYFs74U8FIu2X@aws-1-us-east-1.pooler.supabase.com:6543/postgres';

// ── PostgreSQL 연결 ─────────────────────────────────────
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── DB 테이블 초기화 ────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_users (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL UNIQUE,
      nickname   TEXT NOT NULL,
      password   TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS community_posts (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES community_users(id) ON DELETE CASCADE,
      nickname      TEXT NOT NULL,
      category      TEXT NOT NULL CHECK (category IN ('worry','compliment','cheer','poll')),
      content       TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
      tags          TEXT[] NOT NULL DEFAULT '{}',
      empathy_count INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS community_replies (
      id         TEXT PRIMARY KEY,
      post_id    TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES community_users(id) ON DELETE CASCADE,
      nickname   TEXT NOT NULL,
      content    TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS comm_posts_created_at_idx ON community_posts (created_at DESC);
    CREATE INDEX IF NOT EXISTS comm_posts_empathy_idx    ON community_posts (empathy_count DESC);
    CREATE INDEX IF NOT EXISTS comm_replies_post_idx     ON community_replies (post_id, created_at ASC);
  `);
}

// ── 헬퍼 ────────────────────────────────────────────────
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

function validateEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, nickname: user.nickname },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ── 미들웨어 ───────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// 인증 필수
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, message: '로그인이 필요합니다' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query(
      'SELECT id, email, nickname FROM community_users WHERE id = $1',
      [decoded.id]
    );
    if (!rows[0]) return res.status(401).json({ success: false, message: '유효하지 않은 사용자입니다' });
    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: '유효하지 않은 토큰입니다' });
  }
}

// 인증 선택적
async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next();

    const decoded = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query(
      'SELECT id, email, nickname FROM community_users WHERE id = $1',
      [decoded.id]
    );
    if (rows[0]) req.user = rows[0];
  } catch (_) {
    // 무시
  }
  next();
}

// ═══════════════════════════════════════════════════════
// 인증 API
// ═══════════════════════════════════════════════════════

// POST /api/auth/signup
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, nickname, password } = req.body || {};

    if (!validateEmail(email))
      return res.status(400).json({ success: false, message: '유효한 이메일을 입력해주세요' });
    if (!nickname || nickname.trim().length < 2 || nickname.trim().length > 20)
      return res.status(400).json({ success: false, message: '닉네임은 2~20자여야 합니다' });
    if (!password || password.length < 4 || password.length > 100)
      return res.status(400).json({ success: false, message: '비밀번호는 4자 이상이어야 합니다' });

    const { rows: dup } = await pool.query(
      'SELECT id FROM community_users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (dup[0]) return res.status(409).json({ success: false, message: '이미 가입된 이메일입니다' });

    const hash = await bcrypt.hash(password, 10);
    const id = generateId();
    await pool.query(
      'INSERT INTO community_users (id, email, nickname, password) VALUES ($1, $2, $3, $4)',
      [id, email.toLowerCase(), nickname.trim(), hash]
    );

    const user = { id, email: email.toLowerCase(), nickname: nickname.trim() };
    const token = signToken(user);
    res.status(201).json({ success: true, data: { token, user } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!validateEmail(email) || !password)
      return res.status(400).json({ success: false, message: '이메일과 비밀번호를 입력해주세요' });

    const { rows } = await pool.query(
      'SELECT id, email, nickname, password FROM community_users WHERE email = $1',
      [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다' });

    const safeUser = { id: user.id, email: user.email, nickname: user.nickname };
    const token = signToken(safeUser);
    res.json({ success: true, data: { token, user: safeUser } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, data: { user: req.user } });
});

// ═══════════════════════════════════════════════════════
// 게시글 API
// ═══════════════════════════════════════════════════════

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
             (SELECT COUNT(*)::int FROM community_replies r WHERE r.post_id = p.id) AS reply_count
      FROM community_posts p
      ${where}
      ORDER BY ${orderBy}
    `, params);

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/posts (auth)
app.post('/api/posts', requireAuth, async (req, res) => {
  try {
    const err = validatePost(req.body);
    if (err) return res.status(400).json({ success: false, message: err });

    const { category, content, tags = [] } = req.body;
    const id = generateId();

    await pool.query(
      `INSERT INTO community_posts (id, user_id, nickname, category, content, tags)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, req.user.id, req.user.nickname, category, content.trim(), tags]
    );

    const { rows } = await pool.query(
      'SELECT *, 0 AS reply_count FROM community_posts WHERE id = $1',
      [id]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/posts/:id (auth + owner)
app.patch('/api/posts/:id', requireAuth, async (req, res) => {
  try {
    const { rows: existing } = await pool.query(
      'SELECT * FROM community_posts WHERE id = $1',
      [req.params.id]
    );
    if (!existing[0]) return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다' });
    if (existing[0].user_id !== req.user.id)
      return res.status(403).json({ success: false, message: '본인 글만 수정할 수 있습니다' });

    const { content, tags } = req.body;
    if (content !== undefined && (content.trim().length < 1 || content.trim().length > 500))
      return res.status(400).json({ success: false, message: 'content는 1~500자 사이여야 합니다' });
    if (tags !== undefined && (!Array.isArray(tags) || tags.length > 5))
      return res.status(400).json({ success: false, message: 'tags는 최대 5개까지 가능합니다' });

    await pool.query(
      'UPDATE community_posts SET content = $1, tags = $2 WHERE id = $3',
      [
        content !== undefined ? content.trim() : existing[0].content,
        tags !== undefined ? tags : existing[0].tags,
        req.params.id
      ]
    );

    const { rows } = await pool.query(`
      SELECT p.*, (SELECT COUNT(*)::int FROM community_replies r WHERE r.post_id = p.id) AS reply_count
      FROM community_posts p WHERE p.id = $1
    `, [req.params.id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/posts/:id (auth + owner)
app.delete('/api/posts/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT user_id FROM community_posts WHERE id = $1',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다' });
    if (rows[0].user_id !== req.user.id)
      return res.status(403).json({ success: false, message: '본인 글만 삭제할 수 있습니다' });

    await pool.query('DELETE FROM community_posts WHERE id = $1', [req.params.id]);
    res.json({ success: true, data: null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/posts/:id/empathy (public)
app.post('/api/posts/:id/empathy', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id FROM community_posts WHERE id = $1',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다' });

    const { rows: updated } = await pool.query(
      'UPDATE community_posts SET empathy_count = empathy_count + 1 WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    res.json({ success: true, data: updated[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// 답글 API
// ═══════════════════════════════════════════════════════

// GET /api/posts/:id/replies (public)
app.get('/api/posts/:id/replies', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM community_replies WHERE post_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/posts/:id/replies (auth)
app.post('/api/posts/:id/replies', requireAuth, async (req, res) => {
  try {
    const err = validateReply(req.body);
    if (err) return res.status(400).json({ success: false, message: err });

    const { rows: post } = await pool.query(
      'SELECT id FROM community_posts WHERE id = $1',
      [req.params.id]
    );
    if (!post[0]) return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다' });

    const id = generateId();
    await pool.query(
      `INSERT INTO community_replies (id, post_id, user_id, nickname, content)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, req.params.id, req.user.id, req.user.nickname, req.body.content.trim()]
    );

    const { rows } = await pool.query(
      'SELECT * FROM community_replies WHERE id = $1',
      [id]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Fallback ───────────────────────────────────────────
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── 시작 ───────────────────────────────────────────────
if (require.main === module) {
  initDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`💬 커뮤니티 게시판 서버 실행 중 → http://localhost:${PORT}`);
        console.log(`🗄️  DB: Supabase PostgreSQL`);
      });
    })
    .catch(err => {
      console.error('DB 초기화 실패:', err.message);
      process.exit(1);
    });
}
module.exports = app;
