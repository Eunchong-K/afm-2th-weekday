import Anthropic from "@anthropic-ai/sdk";
import pg from "pg";
import readline from "readline";

const DB_URL =
  "postgresql://postgres.ewmsfpljitindhwddgsk:13mPYFs74U8FIu2X@aws-1-us-east-1.pooler.supabase.com:6543/postgres";

const pool = new pg.Pool({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
});

const client = new Anthropic();

// ── Tools ──────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "query_entries",
    description:
      "Fetch raw entries from the DB. Supports optional filters: month (YYYY-MM), type (income|expense), category.",
    input_schema: {
      type: "object",
      properties: {
        month:     { type: "string", description: "e.g. '2026-04'" },
        type:      { type: "string", enum: ["income", "expense"] },
        category:  { type: "string" },
        limit:     { type: "integer", default: 50 },
      },
    },
  },
  {
    name: "get_monthly_summary",
    description:
      "Returns total income, total expense, and net balance for each month in the DB.",
    input_schema: {
      type: "object",
      properties: {
        year: { type: "string", description: "e.g. '2026' to filter by year (optional)" },
      },
    },
  },
  {
    name: "get_category_breakdown",
    description:
      "Returns per-category total amounts for a given period and type.",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM (optional)" },
        type:  { type: "string", enum: ["income", "expense"] },
      },
    },
  },
  {
    name: "get_top_expenses",
    description: "Returns the N largest expense entries.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", default: 5 },
        month: { type: "string" },
      },
    },
  },
  {
    name: "run_custom_sql",
    description:
      "Run a read-only SELECT query against the entries table. Only SELECT is allowed.",
    input_schema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A valid SELECT SQL statement" },
      },
      required: ["sql"],
    },
  },
];

// ── Tool executor ──────────────────────────────────────────────────────────

async function executeTool(name, input) {
  try {
    switch (name) {
      case "query_entries": {
        const conditions = [];
        const vals = [];
        if (input.month) {
          vals.push(input.month);
          conditions.push(`date LIKE $${vals.length} || '%'`);
          // use LIKE with positional param properly
          conditions.pop();
          conditions.push(`LEFT(date, 7) = $${vals.length}`);
        }
        if (input.type) {
          vals.push(input.type);
          conditions.push(`type = $${vals.length}`);
        }
        if (input.category) {
          vals.push(input.category);
          conditions.push(`category = $${vals.length}`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        vals.push(input.limit ?? 50);
        const sql = `SELECT id, date, type, category, amount, memo
                     FROM entries ${where}
                     ORDER BY date DESC
                     LIMIT $${vals.length}`;
        const { rows } = await pool.query(sql, vals);
        return JSON.stringify(rows);
      }

      case "get_monthly_summary": {
        const vals = [];
        let where = "";
        if (input.year) {
          vals.push(input.year);
          where = `WHERE LEFT(date, 4) = $1`;
        }
        const sql = `
          SELECT
            LEFT(date, 7) AS month,
            SUM(CASE WHEN type='income'  THEN amount ELSE 0 END) AS total_income,
            SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS total_expense,
            SUM(CASE WHEN type='income'  THEN amount ELSE -amount END) AS net
          FROM entries
          ${where}
          GROUP BY LEFT(date, 7)
          ORDER BY month DESC`;
        const { rows } = await pool.query(sql, vals);
        return JSON.stringify(rows);
      }

      case "get_category_breakdown": {
        const conditions = [];
        const vals = [];
        if (input.month) {
          vals.push(input.month);
          conditions.push(`LEFT(date, 7) = $${vals.length}`);
        }
        if (input.type) {
          vals.push(input.type);
          conditions.push(`type = $${vals.length}`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const sql = `
          SELECT category,
                 SUM(amount) AS total,
                 COUNT(*)    AS count
          FROM entries ${where}
          GROUP BY category
          ORDER BY total DESC`;
        const { rows } = await pool.query(sql, vals);
        return JSON.stringify(rows);
      }

      case "get_top_expenses": {
        const vals = [];
        let where = "";
        if (input.month) {
          vals.push(input.month);
          where = `AND LEFT(date, 7) = $1`;
        }
        vals.push(input.limit ?? 5);
        const sql = `
          SELECT date, category, amount, memo
          FROM entries
          WHERE type = 'expense' ${where}
          ORDER BY amount DESC
          LIMIT $${vals.length}`;
        const { rows } = await pool.query(sql, vals);
        return JSON.stringify(rows);
      }

      case "run_custom_sql": {
        const sql = input.sql.trim();
        if (!/^SELECT\b/i.test(sql)) {
          return JSON.stringify({ error: "Only SELECT queries are allowed." });
        }
        const { rows } = await pool.query(sql);
        return JSON.stringify(rows);
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}

// ── Agentic loop ───────────────────────────────────────────────────────────

async function runAgent(userMessage) {
  const messages = [{ role: "user", content: userMessage }];

  process.stdout.write("\n🤖 ");

  while (true) {
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: `당신은 가계부 데이터 분석 전문가입니다.
사용자의 질문에 답하기 위해 제공된 도구를 사용해 Supabase DB에서 데이터를 조회하세요.
- entries 테이블: id, date(YYYY-MM-DD), type(income|expense), category, amount(원), memo, created_at
- 수입 카테고리: 급여, 부업, 이자/투자, 용돈, 환급/상여, 기타수입
- 지출 카테고리: 식비, 교통, 주거/공과금, 쇼핑, 문화/여가, 의료/건강, 교육, 경조사, 기타지출
한국어로 답변하고, 금액은 ₩ 단위로 보기 좋게 표시하세요.`,
      tools: TOOLS,
      messages,
    });

    // collect text while streaming tool calls
    for (const block of response.content) {
      if (block.type === "text") {
        process.stdout.write(block.text);
      }
    }

    if (response.stop_reason === "end_turn") break;

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });

      const toolResults = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          process.stdout.write(`\n  🔧 ${block.name}(${JSON.stringify(block.input)})\n  `);
          const result = await executeTool(block.name, block.input);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
      }
      messages.push({ role: "user", content: toolResults });
      process.stdout.write("🤖 ");
      continue;
    }

    break;
  }

  process.stdout.write("\n");
}

// ── CLI ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   💰 가계부 데이터 분석 에이전트      ║");
  console.log("╠══════════════════════════════════════╣");
  console.log("║  'exit' 또는 Ctrl+C 로 종료          ║");
  console.log("╚══════════════════════════════════════╝\n");
  console.log("질문 예시:");
  console.log("  • 이번 달 지출 요약해줘");
  console.log("  • 카테고리별 지출 비교해줘");
  console.log("  • 최근 가장 큰 지출 TOP 5 보여줘");
  console.log("  • 월별 수입/지출 트렌드 분석해줘\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = () => {
    rl.question("💬 질문: ", async (input) => {
      const q = input.trim();
      if (!q || q.toLowerCase() === "exit") {
        console.log("\n👋 에이전트를 종료합니다.");
        await pool.end();
        rl.close();
        return;
      }
      try {
        await runAgent(q);
      } catch (err) {
        console.error(`\n❌ 오류: ${err.message}`);
      }
      ask();
    });
  };

  ask();
}

main();
