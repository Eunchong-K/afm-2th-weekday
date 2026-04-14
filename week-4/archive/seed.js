const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const db = new Database('todos.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY,
    task TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0
  )
`);

const insert = db.prepare('INSERT INTO todos (id, task, done) VALUES (@id, @task, @done)');

const jsonDir = path.join(__dirname, 'todos-json');
const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.json')).sort();

for (const file of files) {
  const todo = JSON.parse(fs.readFileSync(path.join(jsonDir, file), 'utf-8'));
  insert.run({ id: todo.id, task: todo.task, done: todo.done ? 1 : 0 });
}

const rows = db.prepare('SELECT * FROM todos').all();
console.table(rows);
console.log('todos.db 생성 완료!');
db.close();
