import { describe, expect, it } from "vitest";
import { edgeCases } from "../data/edge-cases.ts";
import { orders } from "../data/shop.ts";
import { openDatabase } from "../lib/db.ts";
import { checkProposal } from "../lib/gate.ts";
import { seed } from "../lib/seed.ts";

// Every rule's exact boundary, checked against the real gate with each case's right answer. No AI calls.

describe("edge cases", () => {
  it("each expects a refund on the asking customer's own order", () => {
    for (const c of edgeCases) expect(orders.find((o) => o.id === c.expected.orderId)?.customerId, c.id).toBe(c.customerId);
  });

  for (const c of edgeCases) {
    it(`${c.id}: the gate gives the expected result at the boundary`, () => {
      const db = openDatabase(":memory:");
      seed(db);
      db.prepare("INSERT INTO inbox (id, customer_id, received_on, subject, body) VALUES (?, ?, ?, ?, ?)").run(c.id, c.customerId, c.receivedOn, c.subject, c.body);
      const form = { action: "refund", orderId: c.expected.orderId, amountCents: c.expected.amountCents, reason: "expected", policyLine: "P02" };
      expect(checkProposal(db, c.id, { status: "answered", form }).result).toBe(c.expected.gate);
      db.close();
    });
  }
});
