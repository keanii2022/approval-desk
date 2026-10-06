// Loads the invented shop data, policy, and Inbox into SQLite.
// Usage: npm run seed                  (writes data/approval-desk.db)
//        node scripts/seed.ts <path>   (writes somewhere else, used by tests)
import { DB_PATH, openDatabase } from "../lib/db.ts";
import { SEEDED_TABLES, seed } from "../lib/seed.ts";

const path = process.argv[2] ?? DB_PATH;
const db = openDatabase(path);
seed(db);

const counts = SEEDED_TABLES.map((table) => {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return `${table} ${row.n}`;
});
db.close();

console.log(`Seeded ${path}: ${counts.join(", ")}`);
