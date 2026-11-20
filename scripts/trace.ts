// Prints what the Claude calls cost: calls, tokens, total cost, average time,
// and calls by gate verdict, read from the logbook's gate lines. Visitors' tries
// live in their own copies of the shop, so those are read too.
// Usage: npm run trace               (reads data/approval-desk.db and its visitor copies)
//        npm run trace -- <path>     (reads another database and its visitor copies)
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "../lib/db.ts";
import { formatSummary, summarizeTraces } from "../lib/trace.ts";
import { visitorFolder } from "../lib/visitor-db.ts";

const path = process.argv[2] ?? DB_PATH;
// Opening a missing file would quietly create an empty database.
if (!existsSync(path)) {
  console.error(`No database at ${path}`);
  process.exit(1);
}

const folder = visitorFolder(path);
const copies = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith(".db")).map((f) => join(folder, f)) : [];
const dbs = [path, ...copies].map((p) => new DatabaseSync(p, { readOnly: true }));
const summary = summarizeTraces(dbs);
for (const db of dbs) db.close();

const lines = formatSummary(path, summary);
if (copies.length > 0) lines[0] += ` and ${copies.length} visitor ${copies.length === 1 ? "copy" : "copies"}`;
console.log(lines.join("\n"));
