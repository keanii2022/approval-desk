import { describe, expect, it } from "vitest";
import { hard2Cases } from "../data/hard2-cases.ts";
import { customers, orders } from "../data/shop.ts";
import { openDatabase } from "../lib/db.ts";
import { checkProposal } from "../lib/gate.ts";
import { processRequest } from "../lib/pipeline.ts";
import { seed } from "../lib/seed.ts";

// The second hard set (written by Gemini), checked against the shop data and the real gate. No AI calls.

const orderById = new Map(orders.map((o) => [o.id, o]));

async function shopFor(c: (typeof hard2Cases)[number]) {
  const db = openDatabase(":memory:");
  seed(db);
  const insert = db.prepare("INSERT INTO inbox (id, customer_id, received_on, subject, body) VALUES (?, ?, ?, ?, ?)");
  insert.run(c.id, c.customerId, c.receivedOn, c.subject, c.body);
  for (const h of c.history ?? []) {
    insert.run(h.id, c.customerId, h.receivedOn, h.subject, h.body);
    await processRequest(db, h.id, async () => h.form, "2026-10-01T09:00:00Z");
  }
  return db;
}

describe("second hard set", () => {
  it("has 75 cases with unique IDs, from customers who exist", () => {
    expect(hard2Cases).toHaveLength(75);
    expect(new Set(hard2Cases.map((c) => c.id)).size).toBe(75);
    for (const c of hard2Cases) expect(customers.some((x) => x.id === c.customerId), c.id).toBe(true);
  });

  it("expects a refund only on the asking customer's own order, for a whole number of cents", () => {
    for (const c of hard2Cases.filter((c) => c.expected.action === "refund")) {
      expect(orderById.get(c.expected.orderId as string)?.customerId, c.id).toBe(c.customerId);
      expect(Number.isInteger(c.expected.amountCents) && (c.expected.amountCents as number) > 0, c.id).toBe(true);
    }
  });

  it("the gate never blocks a right answer, even after the case's history", async () => {
    for (const c of hard2Cases) {
      const db = await shopFor(c);
      const form = { action: c.expected.action, orderId: c.expected.orderId, amountCents: c.expected.amountCents, reason: "expected", policyLine: c.expected.policyLine };
      expect(checkProposal(db, c.id, { status: "answered", form }).result, c.id).not.toBe("block");
      db.close();
    }
  });
});
