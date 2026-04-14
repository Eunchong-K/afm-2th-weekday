require('dotenv').config();

const express = require('express');
const path    = require('path');
const { Pool } = require('pg');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is not set');

// --- Database ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "todo-app-01_users" (
      id            SERIAL PRIMARY KEY,
      email         VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      nickname      VARCHAR(50)  NOT NULL,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "todo-app-01_todos" (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER     NOT NULL REFERENCES "todo-app-01_users"(id) ON DELETE CASCADE,
      text        TEXT        NOT NULL,
      completed   BOOLEAN     NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_todo_app_01_todos_user_id
      ON "todo-app-01_todos"(user_id);
  `);
}

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// JWT auth middleware
function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '로그인이 필요합니다' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, message: '토큰이 유효하지 않습니다' });
  }
}

// --- Auth routes ---

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { email, password, nickname } = req.body;
  if (!email || !password || !nickname) {
    return res.status(400).json({ success: false, message: '이메일, 비밀번호, 닉네임을 모두 입력해주세요' });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, message: '비밀번호는 6자 이상이어야 합니다' });
  }
  try {
    const exists = await pool.query('SELECT id FROM "todo-app-01_users" WHERE email = $1', [email]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ success: false, message: '이미 사용 중인 이메일입니다' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const { rows: [user] } = await pool.query(
      'INSERT INTO "todo-app-01_users" (email, password_hash, nickname) VALUES ($1, $2, $3) RETURNING id, email, nickname',
      [email.toLowerCase().trim(), password_hash, nickname.trim()]
    );
    const token = jwt.sign({ id: user.id, email: user.email, nickname: user.nickname }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ success: true, token, user: { id: user.id, email: user.email, nickname: user.nickname } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: '이메일과 비밀번호를 입력해주세요' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM "todo-app-01_users" WHERE email = $1', [email.toLowerCase().trim()]);
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다' });
    }
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다' });
    }
    const token = jwt.sign({ id: user.id, email: user.email, nickname: user.nickname }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: user.id, email: user.email, nickname: user.nickname } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다' });
  }
});

// --- Todo routes (auth required) ---

// GET /api/todos
app.get('/api/todos', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM "todo-app-01_todos" WHERE user_id = $1 ORDER BY created_at ASC',
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Fetch todos error:', err);
    res.status(500).json({ success: false, message: '할 일 목록을 불러오지 못했습니다' });
  }
});

// POST /api/todos
app.post('/api/todos', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, message: '내용을 입력해주세요' });
  }
  try {
    const { rows: [todo] } = await pool.query(
      'INSERT INTO "todo-app-01_todos" (user_id, text) VALUES ($1, $2) RETURNING *',
      [req.user.id, text.trim()]
    );
    res.status(201).json({ success: true, data: todo });
  } catch (err) {
    console.error('Create todo error:', err);
    res.status(500).json({ success: false, message: '할 일 추가에 실패했습니다' });
  }
});

// PATCH /api/todos/:id
app.patch('/api/todos/:id', requireAuth, async (req, res) => {
  const { completed } = req.body;
  if (typeof completed !== 'boolean') {
    return res.status(400).json({ success: false, message: 'completed(boolean) 값이 필요합니다' });
  }
  try {
    const { rows } = await pool.query(
      'UPDATE "todo-app-01_todos" SET completed = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [completed, req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '할 일을 찾을 수 없습니다' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Update todo error:', err);
    res.status(500).json({ success: false, message: '수정에 실패했습니다' });
  }
});

// DELETE /api/todos/:id
app.delete('/api/todos/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM "todo-app-01_todos" WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '할 일을 찾을 수 없습니다' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete todo error:', err);
    res.status(500).json({ success: false, message: '삭제에 실패했습니다' });
  }
});

// --- Start ---
initDB()
  .then(() => {
    if (require.main === module) {
      app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
    }
  })
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });

module.exports = app;
