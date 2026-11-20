// Loads the invented shop data and puts the three overnight requests in front of a
// person (lib/overnight.ts, no AI calls), so the approval screen has something to show. This wipes and reloads the database file it is given.
// Usage: npm run demo                      (data/demo.db, then the app on it)
//        node scripts/prepare-queue.ts <path>   (used by the browser tests)
// It never touches the real database (data/approval-desk.db): it drops that file's
// logbook, which the app otherwise never does.
import { DB_PATH, openDatabase } from "../lib/db.ts";
import { rmSync } from "node:fs";
import { queueOvernight } from "../lib/overnight.ts";
import { countsPath, visitorFolder } from "../lib/visitor-db.ts";
import { seed } from "../lib/seed.ts";

const path = process.argv[2] ?? "data/demo.db";
if (path === DB_PATH) throw new Error(`${DB_PATH} is the real database. Pick another file.`);
// A fresh shop means fresh visitors: their copies and the try counts were made from the old one.
rmSync(visitorFolder(path), { recursive: true, force: true });
rmSync(countsPath(path), { force: true });
const db = openDatabase(path);
seed(db);
db.exec("DROP TABLE IF EXISTS logbook"); // a fresh logbook, so every run starts the same (the logbook is the app's own table)

for (const line of await queueOvernight(db)) console.log(line);
db.close();
console.log(`Ready: ${path}`);
