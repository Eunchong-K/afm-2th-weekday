// ============================================================
// APNEA Freediving Shop - Backend Server
// ============================================================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ------------------------------------------------------------
// App initialization
// ------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// Database configuration
// ------------------------------------------------------------
const DATABASE_URL   = process.env.DATABASE_URL;
const JWT_SECRET     = process.env.JWT_SECRET;
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY;

if (!DATABASE_URL || !JWT_SECRET || !TOSS_SECRET_KEY) {
  console.error('[ERROR] 필수 환경변수 누락 — DATABASE_URL/JWT_SECRET/TOSS_SECRET_KEY 확인 필요');
}
const TABLE_PREFIX = 'apnea-shop';
const PRODUCTS_TABLE = `"${TABLE_PREFIX}_products"`;
const CART_TABLE = `"${TABLE_PREFIX}_cart"`;
const USERS_TABLE = `"${TABLE_PREFIX}_users"`;
const ORDERS_TABLE      = `"${TABLE_PREFIX}_orders"`;
const ORDER_ITEMS_TABLE = `"${TABLE_PREFIX}_order_items"`;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ------------------------------------------------------------
// Dummy product seed data
// ------------------------------------------------------------
const DUMMY_PRODUCTS = [
  {
    name: '프리다이빙 마스크 Deeper',
    price: 89000,
    image_url: 'images/mask-deeper.jpg',
    description: '저용량 렌즈로 더 깊이, 더 선명하게. 프리다이버를 위한 최적의 마스크.',
    stock: 50,
  },
  {
    name: '프리다이빙 마스크 Longer',
    price: 95000,
    image_url: 'images/mask-longer.jpg',
    description: '장시간 착용에도 편안한 실리콘 스커트. 장거리 다이빙을 위한 선택.',
    stock: 30,
  },
  {
    name: '프리다이빙 카본핀 Pro',
    price: 480000,
    image_url: 'images/fin-carbon-pro.jpg',
    description: '경량 카본 소재로 최소한의 힘으로 최대한의 추진력을 발휘합니다.',
    stock: 12,
    options: ['XS(225-235)', 'S(235-250)', 'M(250-265)', 'L(265-285)', 'XL(285-300)'],
  },
  {
    name: '프리다이빙 유리섬유 핀 Challenger',
    price: 280000,
    image_url: 'images/fin-glass-challenger.jpg',
    description: '입문자부터 중급자까지, 뛰어난 가성비의 유리섬유 롱핀.',
    stock: 4,
    options: ['XS(225-235)', 'S(235-250)', 'M(250-265)', 'L(265-285)', 'XL(285-300)'],
  },
  {
    name: '롱핀 메쉬백',
    price: 35000,
    image_url: 'images/mesh-bag.jpg',
    description: '롱핀 전용 메쉬 가방. 통기성이 좋아 장비를 깨끗하게 보관.',
    stock: 25,
  },
  {
    name: '판초 타월',
    price: 55000,
    image_url: 'images/poncho-towel.jpg',
    description: '다이빙 후 빠른 체온 회복을 위한 후드형 판초 타월.',
    stock: 20,
  },
  {
    name: '프리다이빙 스노클 AirFlow',
    price: 45000,
    image_url: 'images/snorkel-airflow.jpg',
    description: '편안한 마우스피스와 부드러운 퍼지 밸브로 장시간 사용에도 최적.',
    stock: 3,
  },
];

// ------------------------------------------------------------
// DB initialization (lazy + idempotent)
// ------------------------------------------------------------
let dbInitialized = false;

async function initDB() {
  if (dbInitialized) return;

  // 0-a) orders 스키마 마이그레이션 (구 스키마 → 신 스키마)
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'apnea-shop_orders' AND column_name = 'amount'
      ) THEN
        DROP TABLE IF EXISTS "apnea-shop_order_items";
        DROP TABLE IF EXISTS "apnea-shop_orders" CASCADE;
      END IF;
    END $$;
  `);

  // orders: id, user_id, total_price, paid_at, status
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${ORDERS_TABLE} (
      id            SERIAL PRIMARY KEY,
      toss_order_id VARCHAR(100) UNIQUE NOT NULL,
      user_id       INTEGER NOT NULL,
      total_price   INTEGER NOT NULL,
      status        VARCHAR(50)  DEFAULT 'PENDING',
      payment_key   TEXT,
      paid_at       TIMESTAMPTZ,
      created_at    TIMESTAMPTZ  DEFAULT NOW()
    );
  `);

  // order_items: id, order_id, product_id, quantity, price
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${ORDER_ITEMS_TABLE} (
      id         SERIAL PRIMARY KEY,
      order_id   INTEGER NOT NULL REFERENCES ${ORDERS_TABLE}(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      quantity   INTEGER NOT NULL,
      price      INTEGER NOT NULL
    );
  `);

  // 0-b) users 테이블 생성
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${USERS_TABLE} (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // 1) products 테이블 생성
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${PRODUCTS_TABLE} (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      price INTEGER NOT NULL,
      image_url TEXT,
      description TEXT,
      stock   INTEGER  NOT NULL DEFAULT 100,
      options TEXT[]   NOT NULL DEFAULT '{}'
    );
  `);
  // 기존 테이블 마이그레이션
  await pool.query(`ALTER TABLE ${PRODUCTS_TABLE} ADD COLUMN IF NOT EXISTS stock   INTEGER DEFAULT 100;`);
  await pool.query(`ALTER TABLE ${PRODUCTS_TABLE} ADD COLUMN IF NOT EXISTS options TEXT[]  DEFAULT '{}';`);

  // 제품별 기본 옵션 보장 (항상 덮어쓰기)
  const FIN_OPTIONS     = ['XS(225-235)', 'S(235-250)', 'M(250-265)', 'L(265-285)', 'XL(285-300)'];
  const SNORKEL_OPTIONS = ['화이트', '블랙'];
  await pool.query(
    `UPDATE ${PRODUCTS_TABLE} SET options = $1
     WHERE (name LIKE '%카본핀%' OR name LIKE '%유리섬유 핀%') AND options <> $1`,
    [FIN_OPTIONS]
  );
  await pool.query(
    `UPDATE ${PRODUCTS_TABLE} SET options = $1
     WHERE name LIKE '%AirFlow%' AND options <> $1`,
    [SNORKEL_OPTIONS]
  );

  // 2) cart 테이블 생성
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${CART_TABLE} (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(100) NOT NULL,
      product_id INTEGER NOT NULL REFERENCES ${PRODUCTS_TABLE}(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL DEFAULT 1,
      variant VARCHAR(100)
    );
  `);
  // 기존 테이블 마이그레이션: variant 컬럼 추가
  await pool.query(`ALTER TABLE ${CART_TABLE} ADD COLUMN IF NOT EXISTS variant VARCHAR(100);`);

  // 3) 더미 데이터 시드 (테이블이 비어있을 때만)
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM ${PRODUCTS_TABLE};`);
  if (rows[0].count === 0) {
    console.log('[DB] products 테이블 비어있음 → 더미 데이터 시드 시작');
    for (const p of DUMMY_PRODUCTS) {
      await pool.query(
        `INSERT INTO ${PRODUCTS_TABLE} (name, price, image_url, description, stock, options)
         VALUES ($1, $2, $3, $4, $5, $6);`,
        [p.name, p.price, p.image_url, p.description, p.stock ?? 100, p.options ?? []]
      );
    }
    console.log(`[DB] 더미 데이터 ${DUMMY_PRODUCTS.length}개 INSERT 완료`);
  }

  dbInitialized = true;
  console.log('[DB] 초기화 완료');
}

// ------------------------------------------------------------
// Middleware
// ------------------------------------------------------------
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use('/images', express.static(path.join(__dirname, 'images')));

// API 라우트 진입 전 DB init 보장
app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('[DB INIT ERROR]', err);
    res
      .status(500)
      .json({ success: false, message: 'Database initialization failed' });
  }
});

// ============================================================
// JWT 미들웨어
// ============================================================
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, message: '유효하지 않은 토큰입니다.' });
  }
}

// ============================================================
// Routes - Auth
// ============================================================

// POST /api/auth/signup
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, nickname } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: '이메일과 비밀번호를 입력해주세요.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: '비밀번호는 6자 이상이어야 합니다.' });
    }
    const exists = await pool.query(`SELECT id FROM ${USERS_TABLE} WHERE email = $1`, [email]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ success: false, message: '이미 사용 중인 이메일입니다.' });
    }
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO ${USERS_TABLE} (email, password_hash, nickname) VALUES ($1, $2, $3) RETURNING id, email, nickname`,
      [email, hash, nickname || email.split('@')[0]]
    );
    const user = rows[0];
    const token = jwt.sign({ id: user.id, email: user.email, nickname: user.nickname }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ success: true, token, user });
  } catch (err) {
    console.error('[POST /api/auth/signup]', err);
    res.status(500).json({ success: false, message: '회원가입에 실패했습니다.' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: '이메일과 비밀번호를 입력해주세요.' });
    }
    const { rows } = await pool.query(`SELECT id, email, password_hash, nickname FROM ${USERS_TABLE} WHERE email = $1`, [email]);
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }
    const token = jwt.sign({ id: user.id, email: user.email, nickname: user.nickname }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: user.id, email: user.email, nickname: user.nickname } });
  } catch (err) {
    console.error('[POST /api/auth/login]', err);
    res.status(500).json({ success: false, message: '로그인에 실패했습니다.' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ============================================================
// Routes - Products
// ============================================================

// GET /api/products - 전체 상품 목록
app.get('/api/products', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, price, image_url, description, stock, options
       FROM ${PRODUCTS_TABLE}
       ORDER BY id ASC;`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[GET /api/products]', err);
    res
      .status(500)
      .json({ success: false, message: '상품 목록을 불러오지 못했습니다.' });
  }
});

// GET /api/products/:id - 단일 상품 조회
app.get('/api/products/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res
        .status(400)
        .json({ success: false, message: '유효하지 않은 상품 ID 입니다.' });
    }

    const { rows } = await pool.query(
      `SELECT id, name, price, image_url, description, stock, options
       FROM ${PRODUCTS_TABLE}
       WHERE id = $1;`,
      [id]
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[GET /api/products/:id]', err);
    res
      .status(500)
      .json({ success: false, message: '상품 조회에 실패했습니다.' });
  }
});

// ============================================================
// Routes - Cart
// ============================================================

// GET /api/cart - 내 장바구니 (JWT 인증)
app.get('/api/cart', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows } = await pool.query(
      `SELECT
         c.id            AS id,
         c.user_id       AS user_id,
         c.product_id    AS product_id,
         c.quantity      AS quantity,
         c.variant       AS variant,
         p.name          AS name,
         p.price         AS price,
         p.image_url     AS image_url,
         p.description   AS description,
         (p.price * c.quantity) AS subtotal
       FROM ${CART_TABLE} c
       JOIN ${PRODUCTS_TABLE} p ON p.id = c.product_id
       WHERE c.user_id = $1
       ORDER BY c.id ASC;`,
      [userId]
    );

    const total = rows.reduce((sum, r) => sum + Number(r.subtotal), 0);

    res.json({ success: true, data: rows, total });
  } catch (err) {
    console.error('[GET /api/cart]', err);
    res
      .status(500)
      .json({ success: false, message: '장바구니 조회에 실패했습니다.' });
  }
});

// POST /api/cart - 장바구니에 추가 (JWT 인증)
app.post('/api/cart', authMiddleware, async (req, res) => {
  try {
    const user_id = req.user.id;
    const { product_id, quantity, variant } = req.body || {};
    const qty = Number(quantity) || 1;
    const variantVal = variant || null;

    if (!product_id) {
      return res.status(400).json({ success: false, message: 'product_id 가 필요합니다.' });
    }
    if (qty <= 0) {
      return res
        .status(400)
        .json({ success: false, message: 'quantity 는 1 이상이어야 합니다.' });
    }

    // 상품 존재 확인
    const productCheck = await pool.query(
      `SELECT id FROM ${PRODUCTS_TABLE} WHERE id = $1;`,
      [product_id]
    );
    if (productCheck.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: '존재하지 않는 상품입니다.' });
    }

    // 이미 장바구니에 있는지 확인 (variant 포함하여 구분)
    const existing = await pool.query(
      `SELECT id, quantity FROM ${CART_TABLE}
       WHERE user_id = $1 AND product_id = $2 AND COALESCE(variant,'') = COALESCE($3,'');`,
      [user_id, product_id, variantVal]
    );

    let result;
    if (existing.rows.length > 0) {
      const newQty = existing.rows[0].quantity + qty;
      const updated = await pool.query(
        `UPDATE ${CART_TABLE}
         SET quantity = $1
         WHERE id = $2
         RETURNING id, user_id, product_id, quantity, variant;`,
        [newQty, existing.rows[0].id]
      );
      result = updated.rows[0];
    } else {
      const inserted = await pool.query(
        `INSERT INTO ${CART_TABLE} (user_id, product_id, quantity, variant)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, product_id, quantity, variant;`,
        [user_id, product_id, qty, variantVal]
      );
      result = inserted.rows[0];
    }

    res.status(201).json({
      success: true,
      data: result,
      message: '장바구니에 담겼습니다.',
    });
  } catch (err) {
    console.error('[POST /api/cart]', err);
    res
      .status(500)
      .json({ success: false, message: '장바구니 담기에 실패했습니다.' });
  }
});

// PATCH /api/cart/:id - quantity 업데이트 (JWT 인증)
app.patch('/api/cart/:id', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { quantity } = req.body || {};
    const qty = Number(quantity);

    if (!Number.isInteger(id) || id <= 0) {
      return res
        .status(400)
        .json({ success: false, message: '유효하지 않은 cart ID 입니다.' });
    }
    if (!Number.isFinite(qty) || qty < 0) {
      return res
        .status(400)
        .json({ success: false, message: 'quantity 는 0 이상의 숫자여야 합니다.' });
    }

    if (qty === 0) {
      const deleted = await pool.query(
        `DELETE FROM ${CART_TABLE} WHERE id = $1 AND user_id = $2 RETURNING id;`,
        [id, req.user.id]
      );
      if (deleted.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: '장바구니 항목을 찾을 수 없습니다.' });
      }
      return res.json({
        success: true,
        data: { id: deleted.rows[0].id, deleted: true },
        message: '수량이 0이어서 항목이 삭제되었습니다.',
      });
    }

    const updated = await pool.query(
      `UPDATE ${CART_TABLE}
       SET quantity = $1
       WHERE id = $2 AND user_id = $3
       RETURNING id, user_id, product_id, quantity;`,
      [qty, id, req.user.id]
    );

    if (updated.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: '장바구니 항목을 찾을 수 없습니다.' });
    }

    res.json({ success: true, data: updated.rows[0] });
  } catch (err) {
    console.error('[PATCH /api/cart/:id]', err);
    res
      .status(500)
      .json({ success: false, message: '수량 변경에 실패했습니다.' });
  }
});

// DELETE /api/cart/:id - 장바구니 항목 삭제 (JWT 인증)
app.delete('/api/cart/:id', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res
        .status(400)
        .json({ success: false, message: '유효하지 않은 cart ID 입니다.' });
    }

    const deleted = await pool.query(
      `DELETE FROM ${CART_TABLE} WHERE id = $1 AND user_id = $2 RETURNING id;`,
      [id, req.user.id]
    );

    if (deleted.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: '장바구니 항목을 찾을 수 없습니다.' });
    }

    res.json({
      success: true,
      data: { id: deleted.rows[0].id },
      message: '항목이 삭제되었습니다.',
    });
  } catch (err) {
    console.error('[DELETE /api/cart/:id]', err);
    res
      .status(500)
      .json({ success: false, message: '항목 삭제에 실패했습니다.' });
  }
});

// ============================================================
// Routes - Orders & TossPayments
// ============================================================

// POST /api/orders - DB 장바구니 → 주문 생성 (JWT 인증)
app.post('/api/orders', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    // 장바구니 조회 (price는 DB products 기준으로 계산 — 위변조 방지)
    const { rows: cartItems } = await client.query(
      `SELECT c.id, c.product_id, c.quantity, p.name, p.price
       FROM ${CART_TABLE} c
       JOIN ${PRODUCTS_TABLE} p ON p.id = c.product_id
       WHERE c.user_id = $1`,
      [req.user.id]
    );
    if (!cartItems.length) {
      return res.status(400).json({ success: false, message: '장바구니가 비어 있습니다.' });
    }

    const totalPrice = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
    const orderName  = cartItems.length === 1
      ? cartItems[0].name
      : `${cartItems[0].name} 외 ${cartItems.length - 1}건`;
    const tossOrderId = `APNEA-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    await client.query('BEGIN');

    const { rows: [order] } = await client.query(
      `INSERT INTO ${ORDERS_TABLE} (toss_order_id, user_id, total_price)
       VALUES ($1, $2, $3) RETURNING id`,
      [tossOrderId, req.user.id, totalPrice]
    );

    for (const item of cartItems) {
      await client.query(
        `INSERT INTO ${ORDER_ITEMS_TABLE} (order_id, product_id, quantity, price)
         VALUES ($1, $2, $3, $4)`,
        [order.id, item.product_id, item.quantity, item.price]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, data: { tossOrderId, orderName, totalPrice } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[POST /api/orders]', err);
    res.status(500).json({ success: false, message: '주문 생성에 실패했습니다.' });
  } finally {
    client.release();
  }
});

// GET /success - 토스페이먼츠 결제 성공 콜백
app.get('/success', async (req, res) => {
  const { paymentKey, orderId, amount } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ${ORDERS_TABLE} WHERE toss_order_id = $1`, [orderId]
    );
    if (!rows.length) {
      return res.redirect(`/?payment=fail&message=${encodeURIComponent('주문을 찾을 수 없습니다.')}`);
    }
    const order = rows[0];

    // 이중결제 방지: 이미 처리된 주문이면 성공 페이지로 리다이렉트
    if (order.status === 'DONE') {
      return res.redirect(`/?payment=success&orderName=${encodeURIComponent('주문')}&amount=${order.total_price}`);
    }

    // 금액 위변조 검증
    if (Number(order.total_price) !== Number(amount)) {
      return res.redirect(`/?payment=fail&message=${encodeURIComponent('결제 금액이 일치하지 않습니다.')}`);
    }

    // 서버에서 토스페이먼츠 결제 승인 API 호출 (Secret Key 서버에서만 사용)
    const confirmRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(TOSS_SECRET_KEY + ':').toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) }),
    });
    const confirmData = await confirmRes.json();

    if (confirmRes.ok) {
      await pool.query(
        `UPDATE ${ORDERS_TABLE} SET status='DONE', payment_key=$1, paid_at=NOW() WHERE id=$2`,
        [paymentKey, order.id]
      );
      await pool.query(`DELETE FROM ${CART_TABLE} WHERE user_id=$1`, [order.user_id]);

      // 주문명 조회
      const { rows: items } = await pool.query(
        `SELECT p.name FROM ${ORDER_ITEMS_TABLE} oi
         JOIN ${PRODUCTS_TABLE} p ON p.id = oi.product_id
         WHERE oi.order_id = $1 LIMIT 1`, [order.id]
      );
      const orderName = items.length ? items[0].name : '주문';
      return res.redirect(
        `/?payment=success&orderName=${encodeURIComponent(orderName)}&amount=${order.total_price}`
      );
    } else {
      await pool.query(`UPDATE ${ORDERS_TABLE} SET status='FAILED' WHERE id=$1`, [order.id]);
      return res.redirect(
        `/?payment=fail&message=${encodeURIComponent(confirmData.message || '결제 승인에 실패했습니다.')}`
      );
    }
  } catch (err) {
    console.error('[GET /success]', err);
    res.redirect(`/?payment=fail&message=${encodeURIComponent('결제 처리 중 오류가 발생했습니다.')}`);
  }
});

// GET /fail - 토스페이먼츠 결제 실패 콜백
app.get('/fail', async (req, res) => {
  const { message, orderId } = req.query;
  if (orderId) {
    await pool.query(
      `UPDATE ${ORDERS_TABLE} SET status='FAILED' WHERE toss_order_id=$1`, [orderId]
    ).catch(() => {});
  }
  res.redirect(`/?payment=fail&message=${encodeURIComponent(message || '결제에 실패했습니다.')}`);
});

// GET /api/mypage/orders - 본인 주문 내역 (JWT 인증)
app.get('/api/mypage/orders', authMiddleware, async (req, res) => {
  try {
    const { rows: orders } = await pool.query(
      `SELECT id, toss_order_id, total_price, status, paid_at, created_at
       FROM ${ORDERS_TABLE}
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    // 각 주문의 order_items + 상품명 조회
    const result = await Promise.all(orders.map(async (o) => {
      const { rows: items } = await pool.query(
        `SELECT oi.quantity, oi.price, p.name, p.image_url
         FROM ${ORDER_ITEMS_TABLE} oi
         JOIN ${PRODUCTS_TABLE} p ON p.id = oi.product_id
         WHERE oi.order_id = $1`,
        [o.id]
      );
      return { ...o, items };
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[GET /api/mypage/orders]', err);
    res.status(500).json({ success: false, message: '주문 내역 조회에 실패했습니다.' });
  }
});

// ============================================================
// SPA fallback - index.html
// ============================================================
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// Global error handler
// ============================================================
app.use((err, _req, res, _next) => {
  console.error('[UNHANDLED ERROR]', err);
  res
    .status(500)
    .json({ success: false, message: '서버 내부 오류가 발생했습니다.' });
});

// ============================================================
// Server startup
// ============================================================
if (require.main === module) {
  (async () => {
    try {
      await initDB();
      app.listen(PORT, () => {
        console.log('============================================');
        console.log(`  APNEA Shop server running`);
        console.log(`  http://localhost:${PORT}`);
        console.log('============================================');
      });
    } catch (err) {
      console.error('[STARTUP ERROR]', err);
      process.exit(1);
    }
  })();
}

module.exports = app;
