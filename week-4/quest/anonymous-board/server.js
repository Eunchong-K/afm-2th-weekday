require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const Database = require('better-sqlite3');

const app  = express();
const PORT = process.env.PORT || 3004;

// ── DB 초기화 ─────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'board.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id            TEXT PRIMARY KEY,
    category      TEXT NOT NULL CHECK (category IN ('worry','compliment','cheer','poll')),
    content       TEXT NOT NULL,
    tags          TEXT NOT NULL DEFAULT '[]',
    empathy_count INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS replies (
    id         TEXT PRIMARY KEY,
    post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS posts_created_at_idx    ON posts (created_at DESC);
  CREATE INDEX IF NOT EXISTS posts_empathy_count_idx ON posts (empathy_count DESC);
  CREATE INDEX IF NOT EXISTS replies_post_id_idx     ON replies (post_id, created_at ASC);
`);

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
app.get('/api/posts', (req, res) => {
  try {
    const { sort = 'latest', category } = req.query;
    const orderBy = sort === 'empathy' ? 'p.empathy_count DESC' : 'p.created_at DESC';

    let sql = `
      SELECT p.*,
             (SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id) AS reply_count
      FROM posts p
    `;
    const params = [];

    if (category && VALID_CATEGORIES.includes(category)) {
      sql += ' WHERE p.category = ?';
      params.push(category);
    }

    sql += ` ORDER BY ${orderBy}`;

    const rows = db.prepare(sql).all(...params);
    const data = rows.map(r => ({ ...r, tags: JSON.parse(r.tags) }));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/posts
app.post('/api/posts', (req, res) => {
  try {
    const err = validatePost(req.body);
    if (err) return res.status(400).json({ success: false, message: err });

    const { category, content, tags = [] } = req.body;
    const id = generateId();

    db.prepare(
      'INSERT INTO posts (id, category, content, tags) VALUES (?, ?, ?, ?)'
    ).run(id, category, content.trim(), JSON.stringify(tags));

    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: { ...row, tags: JSON.parse(row.tags), reply_count: 0 } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/posts/:id
app.patch('/api/posts/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다' });

    const { content, tags } = req.body;
    if (content !== undefined) {
      const trimmed = content.trim();
      if (trimmed.length < 1 || trimmed.length > 500)
        return res.status(400).json({ success: false, message: 'content는 1~500자 사이여야 합니다' });
    }
    if (tags !== undefined && (!Array.isArray(tags) || tags.length > 5))
      return res.status(400).json({ success: false, message: 'tags는 최대 5개까지 가능합니다' });

    db.prepare('UPDATE posts SET content = ?, tags = ? WHERE id = ?').run(
      content !== undefined ? content.trim() : existing.content,
      tags !== undefined ? JSON.stringify(tags) : existing.tags,
      req.params.id
    );

    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    const replyCount = db.prepare('SELECT COUNT(*) as cnt FROM replies WHERE post_id = ?').get(req.params.id).cnt;
    res.json({ success: true, data: { ...row, tags: JSON.parse(row.tags), reply_count: replyCount } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/posts/:id
app.delete('/api/posts/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다' });

    db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
    res.json({ success: true, data: null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 공감 API ──────────────────────────────────────────────

// POST /api/posts/:id/empathy
app.post('/api/posts/:id/empathy', (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다' });

    db.prepare('UPDATE posts SET empathy_count = empathy_count + 1 WHERE id = ?').run(req.params.id);
    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: { ...row, tags: JSON.parse(row.tags) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 답글 API ──────────────────────────────────────────────

// GET /api/posts/:id/replies
app.get('/api/posts/:id/replies', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT * FROM replies WHERE post_id = ? ORDER BY created_at ASC'
    ).all(req.params.id);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/posts/:id/replies
app.post('/api/posts/:id/replies', (req, res) => {
  try {
    const err = validateReply(req.body);
    if (err) return res.status(400).json({ success: false, message: err });

    const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다' });

    const id = generateId();
    db.prepare(
      'INSERT INTO replies (id, post_id, content) VALUES (?, ?, ?)'
    ).run(id, req.params.id, req.body.content.trim());

    const row = db.prepare('SELECT * FROM replies WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: row });
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
  app.listen(PORT, () => {
    console.log(`📋 익명 게시판 서버 실행 중 → http://localhost:${PORT}`);
    console.log(`💾 DB 파일: ${path.join(__dirname, 'board.db')}`);
  });
}
module.exports = app;
