// Prints what the Claude calls cost: calls, tokens, total cost, average time,
// and calls by gate verdict, read from the logbook's gate lines.
// Usage: npm run trace               (reads data/approval-desk.db)
//        npm run trace -- <path>     (reads another database)
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "../lib/db.ts";
import { formatSummary, summarizeTraces } from "../lib/trace.ts";

const path = process.argv[2] ?? DB_PATH;
// Opening a missing file would quietly create an empty database.
if (!existsSync(path)) {
  console.error(`No database at ${path}`);
  process.exit(1);
}

const db = new DatabaseSync(path, { readOnly: true });
const summary = summarizeTraces(db);
db.close();

console.log(formatSummary(path, summary).join("\n"));
