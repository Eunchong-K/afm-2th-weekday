const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = __dirname;

// ------------------------------------
// Middleware
// ------------------------------------
app.use(express.json());
app.use(express.static(DATA_DIR));

// ------------------------------------
// Helpers
// ------------------------------------

// Find all todo files and return their numeric ids
function getTodoIds() {
  return fs.readdirSync(DATA_DIR)
    .filter(f => /^todo\d+$/.test(f))
    .map(f => parseInt(f.replace('todo', ''), 10))
    .sort((a, b) => a - b);
}

// Read a single todo file and return { id, text, done }
function readTodo(id) {
  const filePath = path.join(DATA_DIR, `todo${id}`);
  const content = fs.readFileSync(filePath, 'utf-8');
  const obj = JSON.parse(content);
  return { id, text: obj.task, done: Boolean(obj.done) };
}

// Write a todo file as JSON
function writeTodo(id, text, done) {
  const filePath = path.join(DATA_DIR, `todo${id}`);
  fs.writeFileSync(filePath, JSON.stringify({ task: text, done }, null, 2), 'utf-8');
}

// ------------------------------------
// API Routes
// ------------------------------------

// GET /api/todos — list all todos, newest (highest id) first
app.get('/api/todos', (_req, res) => {
  try {
    const ids = getTodoIds();
    const todos = ids.map(id => readTodo(id)).reverse();
    res.json({ success: true, data: todos });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to read todos' });
  }
});

// POST /api/todos — create a new todo
app.post('/api/todos', (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Text is required' });
    }

    const ids = getTodoIds();
    const nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1;

    writeTodo(nextId, text.trim(), false);

    res.status(201).json({ success: true, data: { id: nextId, text: text.trim(), done: false } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create todo' });
  }
});

// PUT /api/todos/:id — update done status
app.put('/api/todos/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const filePath = path.join(DATA_DIR, `todo${id}`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Todo not found' });
    }

    const todo = readTodo(id);
    const done = req.body.done !== undefined ? Boolean(req.body.done) : todo.done;

    writeTodo(id, todo.text, done);

    res.json({ success: true, data: { id, text: todo.text, done } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update todo' });
  }
});

// DELETE /api/todos/:id — delete a todo
app.delete('/api/todos/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const filePath = path.join(DATA_DIR, `todo${id}`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Todo not found' });
    }

    fs.unlinkSync(filePath);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete todo' });
  }
});

// ------------------------------------
// Start server / Export for Vercel
// ------------------------------------
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
module.exports = app;
