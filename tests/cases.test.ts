import { describe, expect, it } from "vitest";
import { practiceCases } from "../data/cases.ts";
import { customers, orders } from "../data/shop.ts";
import { openDatabase } from "../lib/db.ts";
import { checkProposal } from "../lib/gate.ts";
import { seed } from "../lib/seed.ts";

// The practice cases are data, and these are facts about that data: there are
// 60, 20 are tricky, every one points at real shop data, and every expected
// form really gets the expected answer from the real gate. No AI is called.

const db = openDatabase(":memory:");
seed(db);
const insert = db.prepare("INSERT INTO inbox (id, customer_id, received_on, subject, body) VALUES (?, ?, ?, ?, ?)");
for (const c of practiceCases) insert.run(c.id, c.customerId, c.receivedOn, c.subject, c.body);

const customerIds = new Set(customers.map((c) => c.id));
const orderById = new Map(orders.map((o) => [o.id, o]));

describe("practice cases", () => {
  it("has 60 cases, 20 of them tricky, with unique ids in order", () => {
    expect(practiceCases).toHaveLength(60);
    expect(practiceCases.filter((c) => c.tricky)).toHaveLength(20);
    expect(practiceCases.map((c) => c.id)).toEqual(practiceCases.map((_, i) => `CASE-${String(i + 1).padStart(3, "0")}`));
  });

  it("points only at customers and orders that exist", () => {
    for (const c of practiceCases) {
      expect(customerIds.has(c.customerId), `${c.id}: customer ${c.customerId}`).toBe(true);
      if (c.expected.orderId !== null) {
        expect(orderById.has(c.expected.orderId), `${c.id}: order ${c.expected.orderId}`).toBe(true);
      }
    }
  });

  it("expects a refund only on the asking customer's own order, for a whole number of cents", () => {
    for (const c of practiceCases.filter((c) => c.expected.action === "refund")) {
      const order = orderById.get(c.expected.orderId as string);
      expect(order?.customerId, `${c.id}: order owner`).toBe(c.customerId);
      expect(Number.isInteger(c.expected.amountCents) && (c.expected.amountCents as number) > 0, `${c.id}: amount`).toBe(true);
    }
  });

  it("gets the expected result and rules from the real gate for every expected form", () => {
    for (const c of practiceCases) {
      const form = {
        action: c.expected.action,
        orderId: c.expected.orderId,
        amountCents: c.expected.amountCents,
        reason: "expected answer",
        policyLine: c.expected.policyLine,
      };
      const decision = checkProposal(db, c.id, { status: "answered", form });
      expect(decision, c.id).toEqual({ result: c.expected.gate, rules: c.expected.rules });
    }
  });

  it("never expects a block: the right answer is always something the shop can act on", () => {
    for (const c of practiceCases) expect(c.expected.gate, c.id).not.toBe("block");
  });
});
