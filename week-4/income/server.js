require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3006;

// ── PostgreSQL 연결 ───────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── DB 테이블 초기화 ──────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS income_entries (
      id            TEXT        PRIMARY KEY,
      salary        INTEGER     NOT NULL,
      job_category  TEXT        NOT NULL,
      experience    TEXT        NOT NULL,
      region        TEXT,
      company_size  TEXT,
      food          INTEGER     NOT NULL DEFAULT 0,
      housing       INTEGER     NOT NULL DEFAULT 0,
      transport     INTEGER     NOT NULL DEFAULT 0,
      subscription  INTEGER     NOT NULL DEFAULT 0,
      shopping      INTEGER     NOT NULL DEFAULT 0,
      health        INTEGER     NOT NULL DEFAULT 0,
      leisure       INTEGER     NOT NULL DEFAULT 0,
      other         INTEGER     NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS income_salary_idx       ON income_entries (salary);
    CREATE INDEX IF NOT EXISTS income_job_idx          ON income_entries (job_category);
    CREATE INDEX IF NOT EXISTS income_region_idx       ON income_entries (region);
    CREATE INDEX IF NOT EXISTS income_company_size_idx ON income_entries (company_size);
  `);
}

// ── 헬퍼 ─────────────────────────────────────────────────
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── 미들웨어 ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── API ───────────────────────────────────────────────────

// POST /api/income — 데이터 제출 + 통계 반환
app.post('/api/income', async (req, res) => {
  try {
    const {
      salary, job_category, experience, region, company_size,
      food = 0, housing = 0, transport = 0, subscription = 0,
      shopping = 0, health = 0, leisure = 0, other = 0,
    } = req.body;

    if (!salary || salary <= 0)
      return res.status(400).json({ success: false, message: '월급을 입력해주세요' });
    if (!job_category)
      return res.status(400).json({ success: false, message: '직군을 선택해주세요' });
    if (!experience)
      return res.status(400).json({ success: false, message: '연차를 선택해주세요' });

    const id = generateId();

    // 데이터 저장
    await pool.query(`
      INSERT INTO income_entries
        (id, salary, job_category, experience, region, company_size,
         food, housing, transport, subscription, shopping, health, leisure, other)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    `, [id, salary, job_category, experience, region || null, company_size || null,
        food, housing, transport, subscription, shopping, health, leisure, other]);

    // 전체 통계 계산
    const { rows: allRows } = await pool.query(
      'SELECT salary FROM income_entries ORDER BY salary ASC'
    );
    const salaries = allRows.map(r => r.salary);
    const total = salaries.length;
    const avgSalary = Math.round(salaries.reduce((s, v) => s + v, 0) / total);
    const below = salaries.filter(s => s <= salary).length;
    const percentile = Math.round((1 - below / total) * 100);

    // 급여 분포
    const buckets = [
      { label: '~200만원', min: 0,   max: 200  },
      { label: '200~300', min: 200,  max: 300  },
      { label: '300~400', min: 300,  max: 400  },
      { label: '400~500', min: 400,  max: 500  },
      { label: '500~600', min: 500,  max: 600  },
      { label: '600+',    min: 600,  max: 99999},
    ];
    const distribution = buckets.map(b => ({
      ...b,
      count: salaries.filter(s => s > b.min && s <= b.max).length,
    }));

    // 카테고리별 평균 지출
    const { rows: [avgExp] } = await pool.query(`
      SELECT
        ROUND(AVG(food))::int         AS food,
        ROUND(AVG(housing))::int      AS housing,
        ROUND(AVG(transport))::int    AS transport,
        ROUND(AVG(subscription))::int AS subscription,
        ROUND(AVG(shopping))::int     AS shopping,
        ROUND(AVG(health))::int       AS health,
        ROUND(AVG(leisure))::int      AS leisure,
        ROUND(AVG(other))::int        AS other
      FROM income_entries
    `);

    // 직군별 평균 급여
    const { rows: jobRows } = await pool.query(`
      SELECT job_category AS job, ROUND(AVG(salary))::int AS avg
      FROM income_entries
      GROUP BY job_category
      ORDER BY avg DESC
    `);

    // 거주 지역별 평균 급여
    const { rows: regionRows } = await pool.query(`
      SELECT region, ROUND(AVG(salary))::int AS avg
      FROM income_entries
      WHERE region IS NOT NULL
      GROUP BY region
      ORDER BY avg DESC
      LIMIT 8
    `);

    // 직장 규모별 평균 급여
    const { rows: companyRows } = await pool.query(`
      SELECT company_size AS size, ROUND(AVG(salary))::int AS avg
      FROM income_entries
      WHERE company_size IS NOT NULL
      GROUP BY company_size
      ORDER BY avg DESC
    `);

    res.json({
      success: true,
      data: {
        entryId: id,
        myPercentile: percentile,
        mySalary: salary,
        avgSalary,
        totalCount: total,
        distribution,
        categoryAverages: avgExp,
        jobAverages: jobRows,
        regionAverages: regionRows,
        companySizeAverages: companyRows,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/income/:id — 내 데이터 조회
app.get('/api/income/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM income_entries WHERE id = $1', [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: '데이터를 찾을 수 없습니다' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/income/:id — 내 데이터 수정
app.patch('/api/income/:id', async (req, res) => {
  try {
    const { rows: existing } = await pool.query(
      'SELECT id FROM income_entries WHERE id = $1', [req.params.id]
    );
    if (!existing[0]) return res.status(404).json({ success: false, message: '데이터를 찾을 수 없습니다' });

    const {
      salary, job_category, experience, region, company_size,
      food, housing, transport, subscription, shopping, health, leisure, other,
    } = req.body;

    await pool.query(`
      UPDATE income_entries SET
        salary = COALESCE($1, salary),
        job_category = COALESCE($2, job_category),
        experience = COALESCE($3, experience),
        region = COALESCE($4, region),
        company_size = COALESCE($5, company_size),
        food = COALESCE($6, food),
        housing = COALESCE($7, housing),
        transport = COALESCE($8, transport),
        subscription = COALESCE($9, subscription),
        shopping = COALESCE($10, shopping),
        health = COALESCE($11, health),
        leisure = COALESCE($12, leisure),
        other = COALESCE($13, other)
      WHERE id = $14
    `, [salary, job_category, experience, region, company_size,
        food, housing, transport, subscription, shopping, health, leisure, other,
        req.params.id]);

    const { rows } = await pool.query('SELECT * FROM income_entries WHERE id = $1', [req.params.id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/income/:id — 내 데이터 삭제
app.delete('/api/income/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id FROM income_entries WHERE id = $1', [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: '데이터를 찾을 수 없습니다' });
    await pool.query('DELETE FROM income_entries WHERE id = $1', [req.params.id]);
    res.json({ success: true, data: null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/income/stats — 전체 통계 조회 (입력 전 참고용)
app.get('/api/income/stats', async (_req, res) => {
  try {
    const { rows: [stats] } = await pool.query(`
      SELECT
        COUNT(*)::int                  AS total_count,
        ROUND(AVG(salary))::int        AS avg_salary,
        MIN(salary)::int               AS min_salary,
        MAX(salary)::int               AS max_salary
      FROM income_entries
    `);
    res.json({ success: true, data: stats });
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
        console.log(`💰 연봉 비교 서버 실행 중 → http://localhost:${PORT}`);
        console.log(`🗄️  DB: Supabase PostgreSQL`);
      });
    })
    .catch(err => {
      console.error('DB 초기화 실패:', err.message);
      process.exit(1);
    });
}
module.exports = app;
