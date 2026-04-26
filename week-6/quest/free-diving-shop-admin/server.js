// ===========================================================================
// APNEA Free Diving Shop - Admin Server  (port 3001)
// ===========================================================================
require('dotenv').config();

const express = require('express');
const path    = require('path');
const cors    = require('cors');
const { Pool } = require('pg');
const ImageKit  = require('imagekit');

const app  = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// DB + ImageKit
// ---------------------------------------------------------------------------
if (!process.env.DATABASE_URL || !process.env.IMAGEKIT_PRIVATE_KEY || !process.env.ADMIN_PASSWORD) {
  console.error('[ERROR] 필수 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.');
  process.exit(1);
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.trim(),
  ssl: { rejectUnauthorized: false },
});

const imagekit = new ImageKit({
  publicKey:   process.env.IMAGEKIT_PUBLIC_KEY.trim(),
  privateKey:  process.env.IMAGEKIT_PRIVATE_KEY.trim(),
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT.trim(),
});

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
const ALLOWED_ORIGIN = process.env.ADMIN_ORIGIN || 'http://localhost:3001';
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Basic Auth — 모든 /api 요청에 적용
function requireAdminAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString();
    const [, pwd] = decoded.split(':');
    if (pwd === ADMIN_PASSWORD) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="APNEA Admin"');
  res.status(401).json({ success: false, message: '관리자 인증이 필요합니다.' });
}

let dbReady = false;
app.use('/api', requireAdminAuth, async (_req, res, next) => {
  if (!dbReady) {
    try {
      await pool.query('SELECT 1');
      await pool.query('ALTER TABLE "apnea-shop_products" ADD COLUMN IF NOT EXISTS stock   INTEGER DEFAULT 100');
      await pool.query('ALTER TABLE "apnea-shop_products" ADD COLUMN IF NOT EXISTS options TEXT[]  DEFAULT \'{}\'');
      dbReady = true;
    }
    catch (e) { return res.status(500).json({ success: false, message: 'DB connection failed' }); }
  }
  next();
});

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------
app.get('/api/stats', async (_req, res) => {
  try {
    const [p, u, c, v, ls, td] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS c FROM "apnea-shop_products"'),
      pool.query('SELECT COUNT(*)::int AS c FROM "apnea-shop_users"'),
      pool.query('SELECT COUNT(*)::int AS c FROM "apnea-shop_cart"'),
      pool.query(`SELECT COALESCE(SUM(p.price * c.quantity),0)::bigint AS total
                  FROM "apnea-shop_cart" c
                  JOIN "apnea-shop_products" p ON p.id = c.product_id`),
      pool.query('SELECT COUNT(*)::int AS c FROM "apnea-shop_products" WHERE stock < 5'),
      pool.query(`SELECT COALESCE(SUM(total_price),0)::bigint AS total
                  FROM "apnea-shop_orders"
                  WHERE status = 'DONE'
                    AND paid_at >= CURRENT_DATE
                    AND paid_at <  CURRENT_DATE + INTERVAL '1 day'`),
    ]);
    res.json({ success: true, data: {
      totalProducts:    p.rows[0].c,
      totalUsers:       u.rows[0].c,
      totalCartItems:   c.rows[0].c,
      totalCartValue:   Number(v.rows[0].total),
      lowStockProducts: ls.rows[0].c,
      todayOrderTotal:  Number(td.rows[0].total),
    }});
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ---------------------------------------------------------------------------
// Products CRUD
// ---------------------------------------------------------------------------
app.get('/api/products', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,name,price,image_url,description,stock,options FROM "apnea-shop_products" ORDER BY id ASC'
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, price, image_url, description, stock, options } = req.body || {};
    if (!name || price == null) return res.status(400).json({ success: false, message: '이름과 가격은 필수입니다.' });
    const { rows } = await pool.query(
      `INSERT INTO "apnea-shop_products" (name,price,image_url,description,stock,options)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, Number(price), image_url || null, description || null,
       stock != null ? Number(stock) : 100,
       Array.isArray(options) ? options : []]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { name, price, image_url, description, stock, options } = req.body || {};
    if (!name || price == null) return res.status(400).json({ success: false, message: '이름과 가격은 필수입니다.' });
    const { rows } = await pool.query(
      `UPDATE "apnea-shop_products" SET name=$1,price=$2,image_url=$3,description=$4,stock=$5,options=$6
       WHERE id=$7 RETURNING *`,
      [name, Number(price), image_url || null, description || null,
       stock != null ? Number(stock) : 0,
       Array.isArray(options) ? options : [],
       Number(req.params.id)]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    res.json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM "apnea-shop_products" WHERE id=$1', [Number(req.params.id)]
    );
    if (!rowCount) return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    res.json({ success: true, message: '삭제되었습니다.' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
app.get('/api/users', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.nickname, u.created_at,
              COALESCE(ct.cart_count,0)::int AS cart_count
       FROM "apnea-shop_users" u
       LEFT JOIN (
         SELECT user_id, COUNT(*)::int AS cart_count
         FROM "apnea-shop_cart" GROUP BY user_id
       ) ct ON ct.user_id = u.id::text
       ORDER BY u.id ASC`
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ---------------------------------------------------------------------------
// Carts
// ---------------------------------------------------------------------------
app.get('/api/carts', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id AS cart_id,
              u.email AS user_email, u.nickname AS user_nickname,
              p.name AS product_name, p.price, c.quantity,
              (p.price * c.quantity)::bigint AS subtotal
       FROM "apnea-shop_cart" c
       JOIN "apnea-shop_users"    u ON u.id::text = c.user_id
       JOIN "apnea-shop_products" p ON p.id = c.product_id
       ORDER BY c.id ASC`
    );
    const grand_total = rows.reduce((s, r) => s + Number(r.subtotal), 0);
    res.json({ success: true, data: rows, grand_total });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
app.get('/api/orders', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         o.id, o.toss_order_id, o.total_price, o.status,
         o.paid_at, o.created_at,
         u.email AS user_email, u.nickname AS user_nickname,
         (SELECT STRING_AGG(p.name || ' x' || oi.quantity, ', ' ORDER BY oi.id)
          FROM "apnea-shop_order_items" oi
          JOIN "apnea-shop_products" p ON p.id = oi.product_id
          WHERE oi.order_id = o.id) AS items_summary
       FROM "apnea-shop_orders" o
       LEFT JOIN "apnea-shop_users" u ON u.id = o.user_id
       ORDER BY o.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ---------------------------------------------------------------------------
// ImageKit auth
// ---------------------------------------------------------------------------
app.get('/api/imagekit-auth', (_req, res) => {
  try {
    const params = imagekit.getAuthenticationParameters();
    res.json({ success: true, ...params });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ---------------------------------------------------------------------------
// SPA fallback
// ---------------------------------------------------------------------------
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`[APNEA Admin] http://localhost:${PORT}`));
}
module.exports = app;
