// Runs the real agent on a few Inbox requests and prints what it filled in and
// what the gate would say. Reads only: nothing is changed, nothing is logged.
// Needs ANTHROPIC_API_KEY in .env and a seeded database (npm run seed).
// Usage: npm run try-agent                       (five varied requests)
//        npm run try-agent -- REQ-003 REQ-007    (the ones you name)
import { DatabaseSync } from "node:sqlite";
import { runAgent } from "../lib/agent.ts";
import { askClaude } from "../lib/claude.ts";
import { DB_PATH } from "../lib/db.ts";
import { checkProposal } from "../lib/gate.ts";

const DEFAULT_REQUESTS = ["REQ-001", "REQ-002", "REQ-018", "REQ-020", "REQ-022"];
const ids = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_REQUESTS;

const db = new DatabaseSync(DB_PATH, { readOnly: true });

for (const id of ids) {
  const request = db.prepare("SELECT subject, body FROM inbox WHERE id = ?").get(id) as
    | { subject: string; body: string }
    | undefined;
  if (!request) {
    console.log(`${id}: not in the Inbox\n`);
    continue;
  }
  const output = await runAgent(db, id, askClaude);
  const decision = checkProposal(db, id, output);
  console.log(`=== ${id}: ${request.subject}`);
  console.log(`Customer wrote: ${request.body}`);
  console.log(`Agent answered: ${JSON.stringify(output.status === "answered" ? output.form : output, null, 2)}`);
  console.log(`Gate says: ${decision.result}${decision.rules.length > 0 ? ` (${decision.rules.join(", ")})` : ""}\n`);
}
db.close();
