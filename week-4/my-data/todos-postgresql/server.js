require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;

// ========================================
// Database Connection
// ========================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ========================================
// Lazy DB Initialization
// ========================================
let dbInitialized = false;

async function initDB() {
  if (dbInitialized) return;

  // Create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS todos (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      done BOOLEAN NOT NULL DEFAULT false
    )
  `);

  // Seed data only if users table is empty
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  if (rows[0].count === 0) {
    // Insert users
    await pool.query(`INSERT INTO users (name) VALUES ('Alice'), ('Bob'), ('Charlie')`);

    // Get user IDs
    const usersResult = await pool.query('SELECT id, name FROM users ORDER BY id');
    const users = usersResult.rows;

    const seedTodos = [
      { name: 'Alice', todos: [
        { text: '장보기 목록 정리하기', done: false },
        { text: 'Read chapter 5 of the book', done: true },
        { text: '운동 30분 하기', done: false },
      ]},
      { name: 'Bob', todos: [
        { text: '이메일 확인하고 답장하기', done: false },
        { text: 'Fix the login bug', done: true },
      ]},
      { name: 'Charlie', todos: [
        { text: '프로젝트 발표 준비', done: false },
        { text: 'Buy groceries', done: false },
        { text: '코드 리뷰 완료하기', done: true },
      ]},
    ];

    for (const seed of seedTodos) {
      const user = users.find(u => u.name === seed.name);
      if (!user) continue;
      for (const todo of seed.todos) {
        await pool.query(
          'INSERT INTO todos (user_id, text, done) VALUES ($1, $2, $3)',
          [user.id, todo.text, todo.done]
        );
      }
    }

    console.log('Seed data inserted.');
  }

  dbInitialized = true;
  console.log('Database initialized.');
}

// ========================================
// Middleware
// ========================================
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// DB init middleware for API routes
app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('DB init error:', err);
    res.status(500).json({ success: false, message: 'Database initialization failed' });
  }
});

// ========================================
// API Routes
// ========================================

// GET /api/users — list all users
app.get('/api/users', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM users ORDER BY id');
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /api/users error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// GET /api/todos — list todos, optionally filtered by user_id
app.get('/api/todos', async (req, res) => {
  try {
    const { user_id } = req.query;
    let rows;
    if (user_id) {
      const result = await pool.query(
        'SELECT id, user_id, text, done FROM todos WHERE user_id = $1 ORDER BY id DESC',
        [user_id]
      );
      rows = result.rows;
    } else {
      const result = await pool.query('SELECT id, user_id, text, done FROM todos ORDER BY id DESC');
      rows = result.rows;
    }
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /api/todos error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch todos' });
  }
});

// POST /api/todos — create a new todo
app.post('/api/todos', async (req, res) => {
  try {
    const { user_id, text } = req.body;
    if (!user_id || !text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'user_id and text are required' });
    }
    const { rows } = await pool.query(
      'INSERT INTO todos (user_id, text) VALUES ($1, $2) RETURNING id, user_id, text, done',
      [user_id, text.trim()]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('POST /api/todos error:', err);
    res.status(500).json({ success: false, message: 'Failed to create todo' });
  }
});

// PUT /api/todos/:id — update done status
app.put('/api/todos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { done } = req.body;
    if (typeof done !== 'boolean') {
      return res.status(400).json({ success: false, message: 'done (boolean) is required' });
    }
    const { rows, rowCount } = await pool.query(
      'UPDATE todos SET done = $1 WHERE id = $2 RETURNING id, user_id, text, done',
      [done, id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Todo not found' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('PUT /api/todos/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to update todo' });
  }
});

// DELETE /api/todos/:id — delete a todo
app.delete('/api/todos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query('DELETE FROM todos WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Todo not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/todos/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete todo' });
  }
});

// ========================================
// Local / Serverless Dual Mode
// ========================================
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
module.exports = app;
