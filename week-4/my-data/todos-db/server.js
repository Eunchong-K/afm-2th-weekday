const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Database Setup (lazy init for serverless compatibility) ──
let dbInitialized = false;
const db = new Database(path.join(__dirname, 'todos.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDB() {
  if (dbInitialized) return;

  // Check if todos table has the expected schema (needs user_id and text columns)
  const columns = db.pragma('table_info(todos)').map(c => c.name);
  const needsMigration = columns.length > 0 && (!columns.includes('user_id') || !columns.includes('text'));

  if (needsMigration) {
    db.exec('DROP TABLE IF EXISTS todos;');
    db.exec('DROP TABLE IF EXISTS users;');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Seed data only if tables are empty
  const userCount = db.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt;
  if (userCount === 0) {
    const insertUser = db.prepare('INSERT INTO users (name) VALUES (?)');
    const insertTodo = db.prepare('INSERT INTO todos (user_id, text, done) VALUES (?, ?, ?)');

    const seed = db.transaction(() => {
      const alice = insertUser.run('Alice').lastInsertRowid;
      const bob = insertUser.run('Bob').lastInsertRowid;
      const charlie = insertUser.run('Charlie').lastInsertRowid;

      insertTodo.run(alice, 'Buy groceries from the supermarket', 0);
      insertTodo.run(alice, 'Finish the weekly project report', 0);
      insertTodo.run(alice, 'Read at least 30 pages of a book', 1);
      insertTodo.run(bob, 'Call the dentist to schedule an appointment', 0);
      insertTodo.run(bob, 'Clean and organize the home office', 1);
      insertTodo.run(charlie, 'Plan the weekend hiking trip', 0);
      insertTodo.run(charlie, 'Practice guitar for 30 minutes', 0);
      insertTodo.run(charlie, 'Update resume and portfolio', 1);
    });
    seed();
  }

  dbInitialized = true;
}

// Ensure DB is ready before any API call
app.use('/api', (_req, _res, next) => {
  try {
    initDB();
    next();
  } catch (err) {
    _res.status(500).json({ success: false, message: 'Database initialization failed' });
  }
});

// ── API Routes ─────────────────────────────────────────

// GET /api/users
app.get('/api/users', (_req, res) => {
  try {
    const users = db.prepare('SELECT id, name FROM users ORDER BY id').all();
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/todos?user_id=1
app.get('/api/todos', (req, res) => {
  try {
    const { user_id } = req.query;
    let todos;
    if (user_id) {
      todos = db.prepare('SELECT id, user_id, text, done FROM todos WHERE user_id = ? ORDER BY id').all(Number(user_id));
    } else {
      todos = db.prepare('SELECT id, user_id, text, done FROM todos ORDER BY id').all();
    }
    // Convert done from 0/1 to boolean
    todos = todos.map(t => ({ ...t, done: Boolean(t.done) }));
    res.json({ success: true, data: todos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/todos
app.post('/api/todos', (req, res) => {
  try {
    const { user_id, text } = req.body;
    if (!user_id || !text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'user_id and text are required' });
    }
    const result = db.prepare('INSERT INTO todos (user_id, text, done) VALUES (?, ?, 0)').run(Number(user_id), text.trim());
    const todo = db.prepare('SELECT id, user_id, text, done FROM todos WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: { ...todo, done: Boolean(todo.done) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/todos/:id
app.put('/api/todos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { done } = req.body;
    if (typeof done !== 'boolean') {
      return res.status(400).json({ success: false, message: 'done (boolean) is required' });
    }
    const existing = db.prepare('SELECT id FROM todos WHERE id = ?').get(Number(id));
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Todo not found' });
    }
    db.prepare('UPDATE todos SET done = ? WHERE id = ?').run(done ? 1 : 0, Number(id));
    const todo = db.prepare('SELECT id, user_id, text, done FROM todos WHERE id = ?').get(Number(id));
    res.json({ success: true, data: { ...todo, done: Boolean(todo.done) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/todos/:id
app.delete('/api/todos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT id FROM todos WHERE id = ?').get(Number(id));
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Todo not found' });
    }
    db.prepare('DELETE FROM todos WHERE id = ?').run(Number(id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Fallback: serve index.html (Express 5 wildcard syntax) ──
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Start Server / Export for Vercel ───────────────────
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
module.exports = app;
