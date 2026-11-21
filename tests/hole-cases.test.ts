import { describe, expect, it } from "vitest";
import { holeCases } from "../data/hole-cases.ts";
import { orders } from "../data/shop.ts";
import { openDatabase } from "../lib/db.ts";
import { checkProposal } from "../lib/gate.ts";
import { processRequest } from "../lib/pipeline.ts";
import { seed } from "../lib/seed.ts";

// The hole cases' right answers, checked against the real gate after each case's
// history has happened. Fixed forms, no AI calls.

async function shopAfterHistory(c: (typeof holeCases)[number]) {
  const db = openDatabase(":memory:");
  seed(db);
  const insert = db.prepare("INSERT INTO inbox (id, customer_id, received_on, subject, body) VALUES (?, ?, ?, ?, ?)");
  insert.run(c.id, c.customerId, c.receivedOn, c.subject, c.body);
  for (const h of c.history) {
    insert.run(h.id, c.customerId, h.receivedOn, h.subject, h.body);
    await processRequest(db, h.id, async () => h.form, "2026-10-01T09:00:00Z");
  }
  return db;
}

describe("hole cases", () => {
  it("each expects a refund on the asking customer's own order", () => {
    for (const c of holeCases.filter((c) => c.expected.action === "refund")) expect(orders.find((o) => o.id === c.expected.orderId)?.customerId, c.id).toBe(c.customerId);
  });

  it("R9 to R12: after its history, every expected answer gets the expected result from the real gate", async () => {
    for (const c of holeCases) {
      const db = await shopAfterHistory(c);
      const form = { action: c.expected.action, orderId: c.expected.orderId, amountCents: c.expected.amountCents, reason: "expected", policyLine: c.expected.policyLine };
      expect(checkProposal(db, c.id, { status: "answered", form }).result, c.id).toBe(c.expected.gate);
      db.close();
    }
  });
});
