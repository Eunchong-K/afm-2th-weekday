require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3005;

// ── PostgreSQL 연결 ───────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── DB 테이블 초기화 ──────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games (
      id         TEXT PRIMARY KEY,
      option_a   TEXT NOT NULL,
      option_b   TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS votes (
      id         TEXT PRIMARY KEY,
      game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      choice     TEXT NOT NULL CHECK (choice IN ('A','B')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS votes_game_id_idx ON votes (game_id);
  `);
}

// ── 헬퍼 ─────────────────────────────────────────────────
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const GAME_WITH_VOTES_SQL = `
  SELECT g.*,
    COUNT(CASE WHEN v.choice='A' THEN 1 END)::int AS votes_a,
    COUNT(CASE WHEN v.choice='B' THEN 1 END)::int AS votes_b,
    COUNT(v.id)::int AS total
  FROM games g
  LEFT JOIN votes v ON v.game_id = g.id
`;

async function getGame(id) {
  const { rows } = await pool.query(
    `${GAME_WITH_VOTES_SQL} WHERE g.id = $1 GROUP BY g.id`, [id]
  );
  return rows[0] || null;
}

async function getAllGames() {
  const { rows } = await pool.query(
    `${GAME_WITH_VOTES_SQL} GROUP BY g.id ORDER BY g.created_at DESC`
  );
  return rows;
}

// ── SSE ───────────────────────────────────────────────────
const sseClients = new Set();

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => client.write(msg));
}

// ── 미들웨어 ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── SSE 엔드포인트 ────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('data: {"type":"connected"}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// ── 게임 API ──────────────────────────────────────────────

// GET /api/games
app.get('/api/games', async (_req, res) => {
  try {
    res.json({ success: true, data: await getAllGames() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/games/:id
app.get('/api/games/:id', async (req, res) => {
  try {
    const game = await getGame(req.params.id);
    if (!game) return res.status(404).json({ success: false, message: '게임을 찾을 수 없습니다' });
    res.json({ success: true, data: game });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/games
app.post('/api/games', async (req, res) => {
  try {
    const { option_a, option_b } = req.body;
    if (!option_a?.trim() || !option_b?.trim())
      return res.status(400).json({ success: false, message: '두 선택지를 모두 입력해주세요' });
    if (option_a.trim().length > 100 || option_b.trim().length > 100)
      return res.status(400).json({ success: false, message: '각 선택지는 100자 이하여야 합니다' });

    const id = generateId();
    await pool.query(
      'INSERT INTO games (id, option_a, option_b) VALUES ($1, $2, $3)',
      [id, option_a.trim(), option_b.trim()]
    );
    res.status(201).json({ success: true, data: await getGame(id) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/games/:id
app.delete('/api/games/:id', async (req, res) => {
  try {
    const game = await getGame(req.params.id);
    if (!game) return res.status(404).json({ success: false, message: '게임을 찾을 수 없습니다' });
    await pool.query('DELETE FROM games WHERE id = $1', [req.params.id]);
    res.json({ success: true, data: null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 투표 API ──────────────────────────────────────────────

// POST /api/games/:id/vote
app.post('/api/games/:id/vote', async (req, res) => {
  try {
    const { choice } = req.body;
    if (!['A', 'B'].includes(choice))
      return res.status(400).json({ success: false, message: "choice는 'A' 또는 'B'여야 합니다" });

    const game = await getGame(req.params.id);
    if (!game) return res.status(404).json({ success: false, message: '게임을 찾을 수 없습니다' });

    await pool.query(
      'INSERT INTO votes (id, game_id, choice) VALUES ($1, $2, $3)',
      [generateId(), req.params.id, choice]
    );

    const updated = await getGame(req.params.id);
    broadcast({ gameId: updated.id, votes_a: updated.votes_a, votes_b: updated.votes_b, total: updated.total });
    res.json({ success: true, data: updated });
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
        console.log(`⚖️  밸런스 게임 서버 실행 중 → http://localhost:${PORT}`);
        console.log(`🗄️  DB: Supabase PostgreSQL`);
      });
    })
    .catch(err => {
      console.error('DB 초기화 실패:', err.message);
      process.exit(1);
    });
}
module.exports = app;
