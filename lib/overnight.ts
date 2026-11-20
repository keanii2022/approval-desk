// Three requests the agent handled "overnight" that the gate sent to a person, so the human
// desk shows what an unattended agent leaves behind. They use fixed forms (no AI calls).
import type { DatabaseSync } from "node:sqlite";
import { processRequest } from "./pipeline.ts";

const refund = (orderId: string, amountCents: number, reason: string) => ({
  action: "refund",
  orderId,
  amountCents,
  reason,
  policyLine: "P02",
});

const NOW = "2026-10-05T12:00:00Z";
const CASES: [string, unknown][] = [
  ["REQ-002", refund("O1002", 15000, "The lamp doesn't work")], // over $100: a person decides
  ["REQ-005", refund("O1005", 4200, "The skillet cracked")], // order is 45 days old: a person decides
  ["REQ-018", null], // the AI is down: the person picks the order
];

/** Runs the overnight requests through the gate. Returns each request's outcome. */
export async function queueOvernight(db: DatabaseSync): Promise<string[]> {
  const outcomes: string[] = [];
  for (const [requestId, form] of CASES) {
    const ask = form === null ? async () => { throw new Error("AI down"); } : async () => form;
    const result = await processRequest(db, requestId, ask, NOW);
    outcomes.push(`${requestId}: ${result.outcome}`);
  }
  return outcomes;
}
