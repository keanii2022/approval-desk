// Runs the holes a skeptic review found against a fresh copy of the shop and
// prints what happened to each request. Nothing here changes the real database.
// Usage: npm run probe            (fixed agent answers, no AI calls, free)
//        npm run probe -- --real  (the real Claude agent, a few cents; reads the key from .env)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AskModel } from "../lib/agent.ts";
import { claudeAgent } from "../lib/claude.ts";
import { openDatabase } from "../lib/db.ts";
import { processRequest } from "../lib/pipeline.ts";
import { seed } from "../lib/seed.ts";
import { formatSummary, summarizeTraces } from "../lib/trace.ts";
import { countTry, spendingProblem } from "../lib/visitor.ts";

const real = process.argv.includes("--real");
const NOW = "2026-10-05T12:00:00Z";
const dir = mkdtempSync(join(tmpdir(), "approval-desk-probe-"));

type Ask = { customerId: string; subject: string; body: string; form: unknown };

const refund = (orderId: string, cents: number, reason: string) => ({ action: "refund", orderId, amountCents: cents, reason, policyLine: "P02" });

// One shop per scenario, so earlier refunds come only from that scenario's own requests.
async function scenario(title: string, asks: Ask[]): Promise<DatabaseSync> {
  const db = openDatabase(join(dir, `${title.replace(/\W+/g, "-")}.db`));
  seed(db);
  console.log(`\n${title}`);
  let paidCents = 0;
  for (const [i, a] of asks.entries()) {
    const id = `PROBE-${i + 1}`;
    db.prepare("INSERT INTO inbox (id, customer_id, received_on, subject, body) VALUES (?, ?, ?, ?, ?)").run(id, a.customerId, "2026-10-01", a.subject, a.body);
    const ask: AskModel = real ? claudeAgent() : async () => a.form;
    const r = await processRequest(db, id, ask, NOW);
    const rules = "rules" in r ? ` (${r.rules.join(", ")})` : "";
    if (r.outcome === "paid") {
      const { amount_cents } = db.prepare("SELECT amount_cents FROM refunds WHERE id = ?").get(r.refundId) as { amount_cents: number };
      paidCents += amount_cents;
      console.log(`  ${id}: paid $${(amount_cents / 100).toFixed(2)}, no person involved`);
    } else console.log(`  ${id}: ${r.outcome.replaceAll("_", " ")}${rules}`);
  }
  console.log(`  total paid with no person: $${(paidCents / 100).toFixed(2)}`);
  return db;
}

const dbs: DatabaseSync[] = [];

// 1. Splitting: a $150 lamp, asked for in pieces under the $100 limit (R2 looks at one request at a time).
dbs.push(
  await scenario("1. Split a $150 refund into two $75 requests", [
    { customerId: "C002", subject: "Lamp broke", body: "My walnut desk lamp (O1002) stopped working. Please refund $75 for now.", form: refund("O1002", 7500, "The lamp is broken") },
    { customerId: "C002", subject: "Rest of my lamp refund", body: "You refunded $75 for my lamp O1002. Please send the other $75.", form: refund("O1002", 7500, "The rest of the lamp refund") },
  ]),
);

// 2. Splitting three ways on a $100 order.
dbs.push(
  await scenario("2. Split a $100 refund three ways", [
    { customerId: "C003", subject: "Blanket torn", body: "My linen blanket (O1003) arrived torn. Could I get $40 back?", form: refund("O1003", 4000, "Torn on arrival") },
    { customerId: "C003", subject: "Blanket again", body: "The tear on my blanket O1003 got worse. Another $40 please.", form: refund("O1003", 4000, "Tear got worse") },
    { customerId: "C003", subject: "Blanket, last bit", body: "Please refund the last $20 on blanket O1003.", form: refund("O1003", 2000, "The rest") },
  ]),
);

// 3. The same complaint twice.
dbs.push(
  await scenario("3. The same complaint sent twice", [
    { customerId: "C006", subject: "Coffee maker cracked", body: "My pour-over coffee maker (O1006) cracked. I'd like $17.50 back.", form: refund("O1006", 1750, "Cracked") },
    { customerId: "C006", subject: "Coffee maker cracked", body: "My pour-over coffee maker (O1006) cracked. I'd like $17.50 back.", form: refund("O1006", 1750, "Cracked") },
  ]),
);

// 4. Accounts that need a look: one flagged, one opened days before ordering.
dbs.push(
  await scenario("4. A flagged account and a brand-new account", [
    { customerId: "C023", subject: "Pillow seam split", body: "The wool throw pillow from order O1036 split along the seam. Could I get $45.00 back? Max", form: refund("O1036", 4500, "Seam split") },
    { customerId: "C024", subject: "Bowl chipped", body: "My ceramic serving bowl (order O1037) arrived chipped. I'd like a refund of $32.00. Juno", form: refund("O1037", 3200, "Chipped") },
  ]),
);
console.log("  still not testable: orders still in transit (orders have no delivery status)");

// 5. Clearing cookies: each "new visitor" gets a fresh hourly allowance until the shared daily cap.
const counts = new DatabaseSync(":memory:");
const limits = { daily: 20, visitorHourly: 5 };
let used = 0;
for (let v = 1; v <= 10 && used < 30; v++) {
  for (let t = 0; t < 5; t++) {
    if (spendingProblem(counts, `cleared-cookie-${v}`, NOW, limits)) break;
    countTry(counts, `cleared-cookie-${v}`, NOW);
    used++;
  }
}
console.log(`\n5. One person clearing cookies\n  got ${used} of the day's ${limits.daily} tries, so nobody else can try until tomorrow`);

if (real) {
  console.log("\nCost of the real calls:");
  console.log(formatSummary("the probe shops", summarizeTraces(dbs)).slice(1).map((l) => "  " + l).join("\n"));
}
for (const db of dbs) db.close();
rmSync(dir, { recursive: true, force: true });
