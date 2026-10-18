// Loads the invented shop data and puts three requests in front of a person, using
// a stand-in agent (fixed forms, no AI calls), so the approval screen has
// something to show. This wipes and reloads the database file it is given.
// Usage: npm run demo                      (data/demo.db, then the app on it)
//        node scripts/prepare-queue.ts <path>   (used by the browser tests)
// It never touches the real database (data/approval-desk.db): it drops that file's
// logbook, which the app otherwise never does.
import { DB_PATH, openDatabase } from "../lib/db.ts";
import { processRequest } from "../lib/pipeline.ts";
import { seed } from "../lib/seed.ts";

const path = process.argv[2] ?? "data/demo.db";
if (path === DB_PATH) throw new Error(`${DB_PATH} is the real database. Pick another file.`);
const db = openDatabase(path);
seed(db);
db.exec("DROP TABLE IF EXISTS logbook"); // a fresh logbook, so every run starts the same (the logbook is the app's own table)

const refund = (orderId: string, amountCents: number, reason: string) => ({
  action: "refund",
  orderId,
  amountCents,
  reason,
  policyLine: "P02",
});

const NOW = "2026-10-05T12:00:00Z";
const cases: [string, unknown][] = [
  ["REQ-002", refund("O1002", 15000, "The lamp doesn't work")], // over $100: a person decides
  ["REQ-005", refund("O1005", 4200, "The skillet cracked")], // order is 45 days old: a person decides
  ["REQ-018", null], // the AI is down: the person picks the order
];

for (const [requestId, form] of cases) {
  const ask = form === null ? async () => { throw new Error("AI down"); } : async () => form;
  const result = await processRequest(db, requestId, ask, NOW);
  console.log(`${requestId}: ${result.outcome}`);
}
db.close();
console.log(`Ready: ${path}`);
