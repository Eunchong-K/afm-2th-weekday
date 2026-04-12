require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── JSON 파일 디렉토리 ──────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const INGREDIENTS_DIR = path.join(DATA_DIR, 'ingredients');
const RECIPES_DIR = path.join(DATA_DIR, 'recipes');

[DATA_DIR, INGREDIENTS_DIR, RECIPES_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// JSON 파일 쓰기/삭제 헬퍼
function writeJsonFile(dir, id, data) {
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(data, null, 2), 'utf-8');
}
function deleteJsonFile(dir, id) {
  const filePath = path.join(dir, `${id}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ── Database Setup ──────────────────────────────────────
const db = new Database(path.join(__dirname, 'fridge.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Anthropic 클라이언트 ────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let dbInitialized = false;
function initDB() {
  if (dbInitialized) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS ingredients (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      quantity    REAL NOT NULL DEFAULT 0,
      unit        TEXT NOT NULL DEFAULT '개',
      storage     TEXT NOT NULL DEFAULT 'cold',
      expiry_date TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      ingredients  TEXT NOT NULL DEFAULT '[]',
      steps        TEXT NOT NULL DEFAULT '[]',
      source       TEXT NOT NULL DEFAULT 'manual',
      created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);

  // 기존 테이블에 source 컬럼이 없으면 추가
  const cols = db.pragma('table_info(recipes)').map(c => c.name);
  if (!cols.includes('source')) {
    db.exec("ALTER TABLE recipes ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");
  }

  // 기존 ingredients 테이블에 expiry_date 컬럼이 없으면 추가
  const ingCols = db.pragma('table_info(ingredients)').map(c => c.name);
  if (!ingCols.includes('expiry_date')) {
    db.exec('ALTER TABLE ingredients ADD COLUMN expiry_date TEXT');
  }

  dbInitialized = true;
}

app.use('/api', (_req, _res, next) => {
  try { initDB(); next(); }
  catch (err) { _res.status(500).json({ success: false, message: 'DB 초기화 실패' }); }
});

// ── 재료 API ───────────────────────────────────────────

// GET /api/ingredients  →  전체 목록 조회
app.get('/api/ingredients', (_req, res) => {
  try {
    const rows = db.prepare(
      'SELECT * FROM ingredients ORDER BY created_at DESC'
    ).all();
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/ingredients  →  재료 등록
app.post('/api/ingredients', (req, res) => {
  try {
    const { name, quantity, unit, storage, expiry_date } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'name 필드가 필요합니다.' });
    }
    const result = db.prepare(
      'INSERT INTO ingredients (name, quantity, unit, storage, expiry_date) VALUES (?, ?, ?, ?, ?)'
    ).run(name.trim(), Number(quantity) || 0, unit || '개', storage || 'cold', expiry_date || null);

    const row = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(result.lastInsertRowid);

    // 개별 JSON 파일 저장
    writeJsonFile(INGREDIENTS_DIR, row.id, row);

    res.status(201).json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/ingredients/:id  →  재료 수정 (수량, 단위, 유통기한)
app.patch('/api/ingredients/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: '재료를 찾을 수 없습니다.' });
    }
    const { quantity, unit, expiry_date } = req.body;
    db.prepare(
      'UPDATE ingredients SET quantity = ?, unit = ?, expiry_date = ? WHERE id = ?'
    ).run(
      quantity !== undefined ? Number(quantity) : existing.quantity,
      unit !== undefined ? unit : existing.unit,
      expiry_date !== undefined ? (expiry_date || null) : existing.expiry_date,
      id
    );
    const row = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id);
    writeJsonFile(INGREDIENTS_DIR, row.id, row);
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/ingredients/:id  →  재료 삭제
app.delete('/api/ingredients/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id FROM ingredients WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: '재료를 찾을 수 없습니다.' });
    }
    db.prepare('DELETE FROM ingredients WHERE id = ?').run(id);
    deleteJsonFile(INGREDIENTS_DIR, id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 레시피 API ─────────────────────────────────────────

// POST /api/recipes/generate  →  AI 레시피 자동 생성 (구체 경로 먼저 등록)
app.post('/api/recipes/generate', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ success: false, message: '.env에 ANTHROPIC_API_KEY가 설정되지 않았습니다.' });
    }

    const { selectedIngredientIds, existingNames = [] } = req.body;

    // 선택된 ID가 있으면 DB에서 해당 재료만 조회, 없으면 전체
    let dbIngredients;
    if (selectedIngredientIds && selectedIngredientIds.length > 0) {
      const placeholders = selectedIngredientIds.map(() => '?').join(',');
      dbIngredients = db.prepare(
        `SELECT * FROM ingredients WHERE id IN (${placeholders})`
      ).all(...selectedIngredientIds);
    } else {
      dbIngredients = db.prepare('SELECT * FROM ingredients ORDER BY name').all();
    }

    if (dbIngredients.length === 0) {
      return res.status(400).json({ success: false, message: '냉장고에 등록된 재료가 없습니다.' });
    }

    const list = dbIngredients
      .map(i => `${i.name} ${i.quantity}${i.unit}`)
      .join(', ');


    const existingNamesText = existingNames.length > 0
      ? `\n아래 레시피 이름은 이미 존재하므로 중복하지 마세요: ${existingNames.join(', ')}`
      : '';

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `당신은 냉장고 재료 관리 앱의 레시피 생성 AI입니다.
사용자가 선택한 재료만 사용해서 레시피를 만드는 것이 핵심 규칙입니다.
선택되지 않은 재료는 절대 레시피에 포함하지 않습니다.
오직 JSON 형식만 출력합니다.`,
      messages: [{
        role: 'user',
        content: `[선택된 냉장고 재료 - 이것만 사용 가능]
${list}

[절대 금지]
- 위 목록에 없는 재료를 ingredients에 추가하는 것
- 위 목록에 없는 재료를 주재료로 사용하는 것
${existingNamesText ? existingNamesText + '\n' : ''}
[허용되는 추가 재료]
- 소금, 후추, 설탕, 간장(목록에 없을 때만), 식용유, 참기름, 다진마늘, 식초, 물 등 기본 양념류만 허용

위 선택된 재료를 주재료로 한 레시피 1개를 아래 JSON 형식으로만 출력하세요. 다른 텍스트는 절대 포함하지 마세요.

{"name":"요리명","ingredients":[{"name":"재료명","quantity":"수량","unit":"단위"}],"steps":["1단계","2단계","3단계"]}`,
      }],
    });

    // 마크다운 코드 블록 제거 후 JSON 추출
    const raw = message.content[0].text.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    const objMatch = raw.match(/\{[\s\S]*\}/);
    const arrMatch = raw.match(/\[[\s\S]*\]/);
    if (!objMatch && !arrMatch) throw new Error('AI 응답 파싱 실패');

    let recipe;
    if (arrMatch && (!objMatch || arrMatch.index < objMatch.index)) {
      const arr = JSON.parse(arrMatch[0]);
      recipe = Array.isArray(arr) ? arr[0] : arr;
    } else {
      recipe = JSON.parse(objMatch[0]);
    }

    if (!recipe || !recipe.name) throw new Error('AI 응답 파싱 실패');

    // 중복 체크
    const duplicate = db.prepare('SELECT id FROM recipes WHERE name = ?').get(recipe.name.trim());
    if (duplicate) {
      return res.status(400).json({ success: false, message: `"${recipe.name}" 레시피가 이미 존재합니다. 다시 시도해주세요.` });
    }

    const iJson = JSON.stringify(Array.isArray(recipe.ingredients) ? recipe.ingredients : []);
    const sJson = JSON.stringify(Array.isArray(recipe.steps) ? recipe.steps : []);
    const result = db.prepare(
      "INSERT INTO recipes (name, ingredients, steps, source) VALUES (?, ?, ?, 'ai')"
    ).run(recipe.name.trim(), iJson, sJson);

    const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(result.lastInsertRowid);
    const saved = { ...row, ingredients: JSON.parse(row.ingredients), steps: JSON.parse(row.steps) };
    writeJsonFile(RECIPES_DIR, row.id, saved);

    res.status(201).json({ success: true, data: [saved] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/recipes/search?q=재료명  →  재료명 포함 레시피 검색
app.get('/api/recipes/search', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    let rows;
    if (!q) {
      rows = db.prepare('SELECT * FROM recipes ORDER BY created_at DESC').all();
    } else {
      rows = db.prepare(
        "SELECT * FROM recipes WHERE name LIKE ? OR ingredients LIKE ? ORDER BY created_at DESC"
      ).all(`%${q}%`, `%${q}%`);
    }
    const data = rows.map(r => ({
      ...r,
      ingredients: JSON.parse(r.ingredients),
      steps: JSON.parse(r.steps),
    }));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/recipes  →  전체 목록 조회
app.get('/api/recipes', (_req, res) => {
  try {
    const rows = db.prepare(
      'SELECT * FROM recipes ORDER BY created_at DESC'
    ).all();
    const data = rows.map(r => ({
      ...r,
      ingredients: JSON.parse(r.ingredients),
      steps: JSON.parse(r.steps),
    }));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/recipes  →  레시피 저장
app.post('/api/recipes', (req, res) => {
  try {
    const { name, ingredients, steps } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'name 필드가 필요합니다.' });
    }
    const ingredientsJson = JSON.stringify(Array.isArray(ingredients) ? ingredients : []);
    const stepsJson = JSON.stringify(Array.isArray(steps) ? steps : []);

    const result = db.prepare(
      'INSERT INTO recipes (name, ingredients, steps) VALUES (?, ?, ?)'
    ).run(name.trim(), ingredientsJson, stepsJson);

    const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(result.lastInsertRowid);
    const data = { ...row, ingredients: JSON.parse(row.ingredients), steps: JSON.parse(row.steps) };

    writeJsonFile(RECIPES_DIR, row.id, data);
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/recipes/:id  →  레시피 삭제
app.delete('/api/recipes/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id FROM recipes WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: '레시피를 찾을 수 없습니다.' });
    }
    db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
    deleteJsonFile(RECIPES_DIR, id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Fallback ────────────────────────────────────────────
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Start ───────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🍽️  냉장고 매니저 서버 실행 중 → http://localhost:${PORT}`);
    console.log(`📁  데이터 폴더: ${DATA_DIR}`);
  });
}
module.exports = app;
