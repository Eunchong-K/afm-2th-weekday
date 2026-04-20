// ========================================
// Module Imports
// ========================================
require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ========================================
// App Initialization & Configuration
// ========================================
const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = (process.env.JWT_SECRET || 'todo-admin-secret-2025').trim();

// ========================================
// Database Connection (Lazy Init)
// ========================================
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').trim(),
  ssl: { rejectUnauthorized: false },
});

// ========================================
// Middleware
// ========================================
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// CORS (로컬 개발 시 다른 포트에서 접근 허용)
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (_req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ========================================
// Auth Middleware
// ========================================
function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '인증 토큰이 필요합니다' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.is_admin) {
      return res.status(403).json({ success: false, message: '관리자 권한이 없습니다' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: '유효하지 않은 토큰입니다' });
  }
}

// ========================================
// API Routes - Auth
// ========================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: '이메일과 비밀번호를 입력해주세요' });
    }

    const result = await pool.query(
      'SELECT * FROM "todo-app-01_users" WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다' });
    }

    if (!user.is_admin) {
      return res.status(403).json({ success: false, message: '관리자 권한이 없습니다' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, nickname: user.nickname, is_admin: user.is_admin },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, nickname: user.nickname, is_admin: user.is_admin },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다' });
  }
});

// ========================================
// API Routes - Admin (requireAdmin 미들웨어 적용)
// ========================================

// GET /api/admin/users - 전체 유저 목록
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, nickname, is_admin, created_at FROM "todo-app-01_users" ORDER BY created_at ASC'
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ success: false, message: '유저 목록을 불러오지 못했습니다' });
  }
});

// GET /api/admin/todos - 전체 할 일 목록 (유저 정보 JOIN)
app.get('/api/admin/todos', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.id, t.user_id, t.text, t.completed, t.created_at,
             u.nickname, u.email
      FROM "todo-app-01_todos" t
      JOIN "todo-app-01_users" u ON t.user_id = u.id
      ORDER BY t.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Get todos error:', err);
    res.status(500).json({ success: false, message: '할 일 목록을 불러오지 못했습니다' });
  }
});

// DELETE /api/admin/users/:id - 유저 삭제
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (userId === req.user.id) {
      return res.status(400).json({ success: false, message: '본인 계정은 삭제할 수 없습니다' });
    }

    // 해당 유저의 할 일도 함께 삭제
    await pool.query('DELETE FROM "todo-app-01_todos" WHERE user_id = $1', [userId]);
    const result = await pool.query('DELETE FROM "todo-app-01_users" WHERE id = $1', [userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: '유저를 찾을 수 없습니다' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ success: false, message: '유저 삭제에 실패했습니다' });
  }
});

// DELETE /api/admin/todos/:id - 할 일 삭제
app.delete('/api/admin/todos/:id', requireAdmin, async (req, res) => {
  try {
    const todoId = parseInt(req.params.id);
    const result = await pool.query('DELETE FROM "todo-app-01_todos" WHERE id = $1', [todoId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: '할 일을 찾을 수 없습니다' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete todo error:', err);
    res.status(500).json({ success: false, message: '할 일 삭제에 실패했습니다' });
  }
});

// ========================================
// Error Handling Middleware
// ========================================
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: '서버 내부 오류가 발생했습니다' });
});

// ========================================
// Server Startup
// ========================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Admin server running on http://localhost:${PORT}`);
  });
}
module.exports = app;
