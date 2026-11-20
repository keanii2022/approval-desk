// Runs before `next start` (see "start" in package.json): on a fresh host the
// database file doesn't exist yet, so seed it once, with the overnight requests waiting. An existing file is left
// alone so approvals and the logbook survive restarts.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH, openDatabase } from "../lib/db.ts";
import { queueOvernight } from "../lib/overnight.ts";
import { countsPath, visitorFolder } from "../lib/visitor-db.ts";
import { seed } from "../lib/seed.ts";

const path = process.env.APPROVAL_DESK_DB ?? DB_PATH;

if (existsSync(path)) {
  console.log(`Using existing database at ${path}`);
} else {
  // A mounted volume path like /data/approval-desk.db may not have its folder yet.
  mkdirSync(dirname(path), { recursive: true });
  const db = openDatabase(path);
  // Copies made from an earlier shop would no longer match this one.
  rmSync(visitorFolder(path), { recursive: true, force: true });
  rmSync(countsPath(path), { force: true });
  seed(db);
  await queueOvernight(db); // so the human desk has what came in overnight
  db.close();
  console.log(`No database at ${path}, seeded a fresh one with the overnight requests`);
}
