import pg from "pg";
import readline from "readline";

const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres.ewmsfpljitindhwddgsk:13mPYFs74U8FIu2X@aws-1-us-east-1.pooler.supabase.com:6543/postgres",
  ssl: { rejectUnauthorized: false },
});

const fmt = (n) => "₩" + Number(n).toLocaleString("ko-KR");
const bar = (val, max, width = 20) => {
  const filled = max > 0 ? Math.round((val / max) * width) : 0;
  return "█".repeat(filled) + "░".repeat(width - filled);
};

// ── 분석 함수들 ────────────────────────────────────────────────────────────

async function showMonthlyStats() {
  const { rows } = await pool.query(`
    SELECT LEFT(date,7) AS month,
           SUM(CASE WHEN type='income'  THEN amount ELSE 0 END) AS income,
           SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS expense,
           SUM(CASE WHEN type='income'  THEN amount ELSE -amount END) AS net,
           COUNT(*) AS cnt
    FROM entries
    GROUP BY LEFT(date,7)
    ORDER BY month DESC
    LIMIT 12`);

  if (!rows.length) { console.log("  데이터 없음\n"); return; }

  console.log("\n  월         수입              지출              순액           건수");
  console.log("  " + "─".repeat(72));
  rows.forEach((r) => {
    const net = Number(r.net);
    const netStr = (net >= 0 ? "+" : "") + fmt(net);
    console.log(
      `  ${r.month}  ${fmt(r.income).padStart(16)}  ${fmt(r.expense).padStart(16)}  ${netStr.padStart(16)}  ${String(r.cnt).padStart(4)}건`
    );
  });
  console.log();
}

async function showCategoryBreakdown() {
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  const month = await new Promise((r) => rl2.question("  월 입력 (YYYY-MM, 엔터=전체): ", r));
  const type  = await new Promise((r) => rl2.question("  유형 (income/expense/엔터=전체): ", r));
  rl2.close();

  const conds = [], vals = [];
  if (month.trim()) { vals.push(month.trim()); conds.push(`LEFT(date,7)=$${vals.length}`); }
  if (type.trim())  { vals.push(type.trim());  conds.push(`type=$${vals.length}`); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";

  const { rows } = await pool.query(
    `SELECT category, type,
            SUM(amount) AS total, COUNT(*) AS cnt
     FROM entries ${where}
     GROUP BY category, type
     ORDER BY total DESC`, vals
  );

  if (!rows.length) { console.log("  데이터 없음\n"); return; }

  const maxTotal = Math.max(...rows.map((r) => Number(r.total)));
  console.log(`\n  카테고리          유형     ${" ".repeat(20)} 합계         건수`);
  console.log("  " + "─".repeat(68));
  rows.forEach((r) => {
    const label = r.category.padEnd(16);
    const typeLabel = (r.type === "income" ? "수입" : "지출").padEnd(4);
    console.log(
      `  ${label}  ${typeLabel}  ${bar(r.total, maxTotal)}  ${fmt(r.total).padStart(12)}  ${r.cnt}건`
    );
  });
  console.log();
}

async function showTopExpenses() {
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  const limitStr = await new Promise((r) => rl2.question("  몇 개? (엔터=10): ", r));
  const month    = await new Promise((r) => rl2.question("  월 필터 (YYYY-MM, 엔터=전체): ", r));
  rl2.close();

  const limit = parseInt(limitStr.trim()) || 10;
  const vals = [limit];
  let where = "";
  if (month.trim()) { vals.unshift(month.trim()); where = "AND LEFT(date,7)=$1"; }

  const { rows } = await pool.query(
    `SELECT date, type, category, amount, memo
     FROM entries
     WHERE type='expense' ${where}
     ORDER BY amount DESC
     LIMIT $${vals.length}`, vals
  );

  if (!rows.length) { console.log("  데이터 없음\n"); return; }

  console.log(`\n  순위  날짜        카테고리          금액           메모`);
  console.log("  " + "─".repeat(68));
  rows.forEach((r, i) => {
    const memo = (r.memo || "-").slice(0, 20);
    console.log(
      `  ${String(i + 1).padStart(3)}위  ${r.date}  ${r.category.padEnd(16)}  ${fmt(r.amount).padStart(12)}  ${memo}`
    );
  });
  console.log();
}

async function showRecentEntries() {
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  const limitStr = await new Promise((r) => rl2.question("  몇 개? (엔터=20): ", r));
  rl2.close();

  const limit = parseInt(limitStr.trim()) || 20;
  const { rows } = await pool.query(
    `SELECT date, type, category, amount, memo
     FROM entries ORDER BY date DESC, created_at DESC LIMIT $1`, [limit]
  );

  if (!rows.length) { console.log("  데이터 없음\n"); return; }

  console.log(`\n  날짜        유형  카테고리          금액           메모`);
  console.log("  " + "─".repeat(68));
  rows.forEach((r) => {
    const typeLabel = r.type === "income" ? "수입" : "지출";
    const sign      = r.type === "income" ? "+" : "-";
    const memo      = (r.memo || "-").slice(0, 20);
    console.log(
      `  ${r.date}  ${typeLabel}  ${r.category.padEnd(16)}  ${(sign + fmt(r.amount)).padStart(13)}  ${memo}`
    );
  });
  console.log();
}

async function showOverallStats() {
  const { rows: [s] } = await pool.query(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN type='income'  THEN amount ELSE 0 END) AS total_income,
           SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS total_expense,
           COUNT(DISTINCT LEFT(date,7)) AS months,
           MIN(date) AS first_date,
           MAX(date) AS last_date
    FROM entries`);

  const net = Number(s.total_income) - Number(s.total_expense);
  console.log(`
  ┌─────────────────────────────────────────┐
  │              전체 통계 요약              │
  ├─────────────────────────────────────────┤
  │  기간       ${s.first_date} ~ ${s.last_date}   │
  │  총 건수    ${String(s.total).padStart(6)}건               │
  │  총 수입    ${fmt(s.total_income).padStart(16)}         │
  │  총 지출    ${fmt(s.total_expense).padStart(16)}         │
  │  순 잔액    ${fmt(net).padStart(16)}  ${net >= 0 ? "✅" : "❌"}      │
  └─────────────────────────────────────────┘`);
}

async function runCustomSQL() {
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  const sql = await new Promise((r) => rl2.question("  SQL> ", r));
  rl2.close();

  if (!/^SELECT\b/i.test(sql.trim())) {
    console.log("  ⚠️  SELECT 문만 허용됩니다.\n");
    return;
  }
  try {
    const { rows, fields } = await pool.query(sql.trim());
    if (!rows.length) { console.log("  결과 없음\n"); return; }

    const headers = fields.map((f) => f.name);
    console.log("\n  " + headers.join("  |  "));
    console.log("  " + "─".repeat(Math.min(headers.join("  |  ").length, 80)));
    rows.forEach((r) => {
      console.log("  " + headers.map((h) => String(r[h] ?? "")).join("  |  "));
    });
    console.log(`\n  (${rows.length}행)\n`);
  } catch (e) {
    console.log(`  ❌ 오류: ${e.message}\n`);
  }
}

// ── 메인 메뉴 ──────────────────────────────────────────────────────────────

async function menu() {
  console.log(`
╔══════════════════════════════════╗
║   📊 가계부 DB 분석 도구         ║
╠══════════════════════════════════╣
║  1. 전체 통계 요약               ║
║  2. 월별 수입/지출 현황          ║
║  3. 카테고리별 분석              ║
║  4. 지출 TOP N                   ║
║  5. 최근 내역 조회               ║
║  6. 직접 SQL 쿼리                ║
║  0. 종료                         ║
╚══════════════════════════════════╝`);
}

async function main() {
  // DB 연결 확인
  try {
    await pool.query("SELECT 1");
    console.log("✅ DB 연결 성공\n");
  } catch (e) {
    console.error("❌ DB 연결 실패:", e.message);
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const loop = async () => {
    await menu();
    rl.question("선택: ", async (choice) => {
      console.log();
      try {
        switch (choice.trim()) {
          case "1": await showOverallStats(); break;
          case "2": await showMonthlyStats(); break;
          case "3": await showCategoryBreakdown(); break;
          case "4": await showTopExpenses(); break;
          case "5": await showRecentEntries(); break;
          case "6": await runCustomSQL(); break;
          case "0":
            console.log("👋 종료합니다.");
            await pool.end();
            rl.close();
            return;
          default:
            console.log("  잘못된 선택입니다.\n");
        }
      } catch (e) {
        console.error("  ❌ 오류:", e.message, "\n");
      }
      loop();
    });
  };

  loop();
}

main();
