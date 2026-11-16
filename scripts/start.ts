// Runs before `next start` (see "start" in package.json): on a fresh host the
// database file doesn't exist yet, so seed it once. An existing file is left
// alone so approvals and the logbook survive restarts.
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH, openDatabase } from "../lib/db.ts";
import { seed } from "../lib/seed.ts";

const path = process.env.APPROVAL_DESK_DB ?? DB_PATH;

if (existsSync(path)) {
  console.log(`Using existing database at ${path}`);
} else {
  // A mounted volume path like /data/approval-desk.db may not have its folder yet.
  mkdirSync(dirname(path), { recursive: true });
  const db = openDatabase(path);
  seed(db);
  db.close();
  console.log(`No database at ${path}, seeded a fresh one`);
}
