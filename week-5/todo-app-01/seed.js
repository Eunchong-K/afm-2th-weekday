const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: 'postgresql://postgres.ewmsfpljitindhwddgsk:13mPYFs74U8FIu2X@aws-1-us-east-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false },
});

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "todo-app-01_users" (
        id            SERIAL PRIMARY KEY,
        email         VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        nickname      VARCHAR(50)  NOT NULL,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✓ todo-app-01_users 테이블 준비');

    // 2. Drop and recreate todos table with user_id
    await client.query(`DROP TABLE IF EXISTS "todo-app-01_todos";`);
    await client.query(`
      CREATE TABLE "todo-app-01_todos" (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER     NOT NULL REFERENCES "todo-app-01_users"(id) ON DELETE CASCADE,
        text        TEXT        NOT NULL,
        completed   BOOLEAN     NOT NULL DEFAULT false,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_todo_app_01_todos_user_id
        ON "todo-app-01_todos"(user_id);
    `);
    console.log('✓ todo-app-01_todos 테이블 준비');

    // 3. Clear existing demo users
    await client.query(`DELETE FROM "todo-app-01_users" WHERE email IN ('alice@demo.com', 'bob@demo.com');`);

    // 4. Insert 2 demo users
    const aliceHash = await bcrypt.hash('alice1234', 10);
    const bobHash   = await bcrypt.hash('bob1234',   10);

    const { rows: [alice] } = await client.query(`
      INSERT INTO "todo-app-01_users" (email, password_hash, nickname)
      VALUES ($1, $2, $3) RETURNING id, email, nickname
    `, ['alice@demo.com', aliceHash, 'Alice']);

    const { rows: [bob] } = await client.query(`
      INSERT INTO "todo-app-01_users" (email, password_hash, nickname)
      VALUES ($1, $2, $3) RETURNING id, email, nickname
    `, ['bob@demo.com', bobHash, 'Bob']);

    console.log(`✓ 유저 생성: ${alice.nickname} (id=${alice.id}), ${bob.nickname} (id=${bob.id})`);

    // 5. Insert todos for Alice
    const aliceTodos = [
      { text: '리액트 복습하기',     completed: true  },
      { text: 'PostgreSQL 스키마 설계', completed: true  },
      { text: 'JWT 인증 구현하기',   completed: false },
      { text: '단위 테스트 작성',    completed: false },
      { text: '배포 환경 세팅',      completed: false },
    ];

    for (const t of aliceTodos) {
      await client.query(`
        INSERT INTO "todo-app-01_todos" (user_id, text, completed)
        VALUES ($1, $2, $3)
      `, [alice.id, t.text, t.completed]);
    }
    console.log(`✓ Alice 할 일 ${aliceTodos.length}개 삽입`);

    // 6. Insert todos for Bob
    const bobTodos = [
      { text: '장보기 — 계란, 우유, 두부', completed: false },
      { text: '헬스장 등록',           completed: true  },
      { text: '독서 — 클린 코드 3장',  completed: false },
      { text: '주간 회고 작성',        completed: false },
    ];

    for (const t of bobTodos) {
      await client.query(`
        INSERT INTO "todo-app-01_todos" (user_id, text, completed)
        VALUES ($1, $2, $3)
      `, [bob.id, t.text, t.completed]);
    }
    console.log(`✓ Bob 할 일 ${bobTodos.length}개 삽입`);

    await client.query('COMMIT');

    // Summary
    console.log('\n=== 데모 데이터 삽입 완료 ===');
    console.log('┌─────────────────────────────────────┐');
    console.log('│  유저       이메일           비밀번호  │');
    console.log('├─────────────────────────────────────┤');
    console.log('│  Alice  alice@demo.com  alice1234   │');
    console.log('│  Bob    bob@demo.com    bob1234     │');
    console.log('└─────────────────────────────────────┘');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('오류 발생, 롤백:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
