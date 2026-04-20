const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const connectionString = (process.env.DATABASE_URL || '').trim();

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('income','expense')),
      category TEXT NOT NULL,
      amount INTEGER NOT NULL,
      memo TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  dbInitialized = true;
}

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/entries', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, date, type, category, amount, memo, created_at FROM entries ORDER BY date DESC, created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/entries', async (req, res) => {
  try {
    const { id, date, type, category, amount, memo } = req.body || {};
    if (!id || !date || !type || !category || amount === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (type !== 'income' && type !== 'expense') {
      return res.status(400).json({ error: 'type must be income or expense' });
    }
    const result = await pool.query(
      `INSERT INTO entries (id, date, type, category, amount, memo)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, date, type, category, amount, memo, created_at`,
      [id, date, type, category, amount, memo || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/entries/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM entries WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    res.json({ id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Budget app server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
