require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ─── Guard: require SECRET_KEY in production ─────────────────────────────────
const IS_VERCEL = !!process.env.VERCEL;
const SECRET_KEY = process.env.SECRET_KEY;
if (!SECRET_KEY) {
  console.error('❌ SECRET_KEY env var is required. Set it in .env or Vercel dashboard.');
  if (IS_VERCEL) process.exit(1);
}
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();

const hashPassword = (pw) =>
  crypto.createHmac('sha256', SECRET_KEY || 'dev-only-key').update(pw).digest('hex');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── DB ────────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Unexpected DB pool error:', err.message);
});

// ─── Middleware ─────────────────────────────────────────────────────────────
// Trim to remove any stray newline/space that shell piping may have added
const allowedOrigin = process.env.ORIGIN ? process.env.ORIGIN.trim() : '*';
app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'DELETE'],
}));
app.use(express.json({ limit: '1mb' }));

// Serve uploads only (NOT the entire project directory)
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!IS_VERCEL && !fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── File upload ────────────────────────────────────────────────────────────
// Vercel: read-only filesystem → use memory storage (images won't persist)
// Local:  disk storage in uploads/
const storage = IS_VERCEL
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => cb(null, UPLOADS_DIR),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safe = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? ext : '.jpg';
        cb(null, `course_${Date.now()}${safe}`);
      },
    });

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('이미지 파일만 업로드 가능합니다.'));
  },
});

// ─── DB init ────────────────────────────────────────────────────────────────
async function initDB() {
  try {
    await pool.query(`
      SET statement_timeout = '20s';
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marked_users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS marked_runs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES marked_users(id) ON DELETE CASCADE,
        city TEXT NOT NULL,
        country TEXT NOT NULL,
        date TEXT NOT NULL,
        km NUMERIC(6,2) NOT NULL,
        minutes INTEGER NOT NULL,
        memo TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS marked_courses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        user_name TEXT DEFAULT '익명',
        city TEXT NOT NULL,
        country TEXT NOT NULL,
        name TEXT NOT NULL,
        distance TEXT DEFAULT '',
        difficulty TEXT DEFAULT '초급',
        description TEXT DEFAULT '',
        map_url TEXT DEFAULT '',
        image_url TEXT DEFAULT '',
        date TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ DB tables ready');
  } catch (err) {
    console.error('❌ DB init error:', err.message);
  }
}

// ─── Input helpers ──────────────────────────────────────────────────────────
const str = (v, max = 200) => String(v || '').trim().slice(0, max);
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ─── Auth ───────────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  const name = str(req.body.name, 50);
  const email = str(req.body.email, 100).toLowerCase();
  const password = str(req.body.password, 100);

  if (!name || !email || !password)
    return res.status(400).json({ error: '이름, 이메일, 비밀번호를 모두 입력하세요.' });
  if (!isValidEmail(email))
    return res.status(400).json({ error: '이메일 형식이 올바르지 않습니다.' });
  if (password.length < 4)
    return res.status(400).json({ error: '비밀번호는 4자 이상이어야 합니다.' });

  try {
    const r = await pool.query(
      'INSERT INTO marked_users (name, email, password) VALUES ($1,$2,$3) RETURNING id, name, email',
      [name, email, hashPassword(password)]
    );
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '이미 사용 중인 이메일입니다.' });
    console.error(err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = str(req.body.email, 100).toLowerCase();
  const password = str(req.body.password, 100);

  if (!email || !password)
    return res.status(400).json({ error: '이메일과 비밀번호를 입력하세요.' });

  try {
    const r = await pool.query(
      'SELECT id, name, email FROM marked_users WHERE email=$1 AND password=$2',
      [email, hashPassword(password)]
    );
    if (r.rows.length === 0)
      return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    const user = r.rows[0];
    res.json({ ...user, isAdmin: ADMIN_EMAIL ? user.email === ADMIN_EMAIL : false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ─── Runs ───────────────────────────────────────────────────────────────────

app.get('/api/runs', async (req, res) => {
  const userId = parseInt(req.query.userId, 10);
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const r = await pool.query(
      'SELECT * FROM marked_runs WHERE user_id=$1 ORDER BY date DESC, created_at DESC',
      [userId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '서버 오류' });
  }
});

app.post('/api/runs', async (req, res) => {
  const userId = parseInt(req.body.userId, 10);
  const city = str(req.body.city, 100);
  const country = str(req.body.country, 100);
  const date = str(req.body.date, 10);
  const km = Math.min(Math.max(parseFloat(req.body.km) || 0, 0), 1000);
  const minutes = Math.min(Math.max(parseInt(req.body.minutes, 10) || 0, 0), 1440);
  const memo = str(req.body.memo, 500);

  if (!userId || !city || !country || !date)
    return res.status(400).json({ error: '필수 입력값을 확인하세요.' });

  try {
    const r = await pool.query(
      `INSERT INTO marked_runs (user_id,city,country,date,km,minutes,memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [userId, city, country, date, km, minutes, memo]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '서버 오류' });
  }
});

app.delete('/api/runs/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const userId = parseInt(req.body.userId, 10);
  if (!id || !userId) return res.status(400).json({ error: '잘못된 요청입니다.' });
  try {
    await pool.query('DELETE FROM marked_runs WHERE id=$1 AND user_id=$2', [id, userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '서버 오류' });
  }
});

app.get('/api/community-runs', async (req, res) => {
  const city = req.query.city ? str(req.query.city, 100) : null;
  try {
    const r = city
      ? await pool.query(
          `SELECT r.id, r.city, r.country, r.date, r.km, r.minutes, r.memo,
                  u.name as user_name
           FROM marked_runs r
           JOIN marked_users u ON r.user_id = u.id
           WHERE r.city=$1
           ORDER BY r.created_at DESC LIMIT 50`,
          [city]
        )
      : await pool.query(
          `SELECT r.id, r.city, r.country, r.date, r.km, r.minutes, r.memo,
                  u.name as user_name
           FROM marked_runs r
           JOIN marked_users u ON r.user_id = u.id
           ORDER BY r.created_at DESC LIMIT 20`
        );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ─── Courses ────────────────────────────────────────────────────────────────

app.get('/api/courses', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM marked_courses ORDER BY created_at DESC');
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '서버 오류' });
  }
});

app.post('/api/courses', upload.single('image'), async (req, res) => {
  const city = str(req.body.city, 100);
  const name = str(req.body.name, 200);
  if (!city || !name) return res.status(400).json({ error: '도시와 코스명은 필수입니다.' });

  const userId = parseInt(req.body.userId, 10) || null;
  const userName = str(req.body.userName, 50) || '익명';
  const country = str(req.body.country, 100);
  const distance = str(req.body.distance, 20);
  const difficulty = str(req.body.difficulty, 10) || '초급';
  const description = str(req.body.description, 1000);
  const mapUrl = str(req.body.mapUrl, 500);
  // On Vercel memory storage, req.file exists but has no filename → skip image
  const imageUrl = (!IS_VERCEL && req.file?.filename) ? `/uploads/${req.file.filename}` : '';
  const today = new Date().toISOString().split('T')[0];
  const date = str(req.body.date, 10) || today;

  try {
    const r = await pool.query(
      `INSERT INTO marked_courses
         (user_id, user_name, city, country, name, distance, difficulty, description, map_url, image_url, date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [userId, userName, city, country, name, distance, difficulty, description, mapUrl, imageUrl, date]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '서버 오류' });
  }
});

app.delete('/api/courses/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const userId = parseInt(req.body.userId, 10) || null;
  if (!id) return res.status(400).json({ error: '잘못된 요청입니다.' });

  try {
    const sel = await pool.query('SELECT image_url, user_id FROM marked_courses WHERE id=$1', [id]);
    if (sel.rows.length === 0) return res.status(404).json({ error: '코스를 찾을 수 없습니다.' });

    const course = sel.rows[0];

    // Admin check
    let isAdmin = false;
    if (ADMIN_EMAIL && userId) {
      const adminCheck = await pool.query('SELECT email FROM marked_users WHERE id=$1', [userId]);
      isAdmin = adminCheck.rows.length > 0 && adminCheck.rows[0].email === ADMIN_EMAIL;
    }

    // Allow: admin always, owner when user_id matches
    if (!isAdmin && course.user_id !== userId) {
      return res.status(403).json({ error: '삭제 권한이 없습니다.' });
    }

    // Path traversal guard
    if (course.image_url && !IS_VERCEL) {
      const filePath = path.resolve(path.join(__dirname, course.image_url));
      if (filePath.startsWith(UPLOADS_DIR) && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await pool.query('DELETE FROM marked_courses WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ─── SPA catch-all ──────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start ──────────────────────────────────────────────────────────────────
// Local: run immediately. Vercel: run lazily on first request to avoid cold-start timeout.
if (!IS_VERCEL) {
  initDB();
  app.listen(PORT, () => console.log(`🏃 Marked running at http://localhost:${PORT}`));
} else {
  // On Vercel, init DB once per cold start inside a request to stay within timeout budget
  let dbReady = false;
  app.use(async (req, res, next) => {
    if (!dbReady) {
      await initDB().catch(() => {});
      dbReady = true;
    }
    next();
  });
}

module.exports = app;
