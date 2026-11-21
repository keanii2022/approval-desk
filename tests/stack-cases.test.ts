import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { type StackCase, stackCases } from "../data/stack-cases.ts";
import { openDatabase } from "../lib/db.ts";
import { checkProposal } from "../lib/gate.ts";
import { processRequest } from "../lib/pipeline.ts";
import { seed } from "../lib/seed.ts";

// Step 24: refunds stacking across one customer's orders. Each history runs through
// the real pipeline with fixed forms, as lib/evals.ts does, then the last request's
// right answer goes to the real gate. No AI calls.

const HISTORY_NOW = "2026-10-01T09:00:00Z";

function addOrdersAndRefunds(db: DatabaseSync, c: Pick<StackCase, "extraOrders" | "earlierRefunds">) {
  const insertOrder = db.prepare("INSERT INTO orders (id, customer_id, placed_on, item, amount_paid_cents, in_transit) VALUES (?, ?, ?, ?, ?, 0)");
  for (const o of c.extraOrders ?? []) insertOrder.run(o.id, o.customerId, o.placedOn, o.item, o.amountPaidCents);
  const insertRefund = db.prepare("INSERT INTO refunds (id, order_id, refunded_on, amount_cents, reason) VALUES (?, ?, ?, ?, ?)");
  for (const r of c.earlierRefunds ?? []) insertRefund.run(r.id, r.orderId, r.refundedOn, r.amountCents, r.reason);
}

async function shopAfterHistory(c: StackCase) {
  const db = openDatabase(":memory:");
  seed(db);
  addOrdersAndRefunds(db, c);
  const insert = db.prepare("INSERT INTO inbox (id, customer_id, received_on, subject, body) VALUES (?, ?, ?, ?, ?)");
  insert.run(c.id, c.customerId, c.receivedOn, c.subject, c.body);
  const outcomes = [];
  for (const h of c.history) {
    insert.run(h.id, c.customerId, h.receivedOn, h.subject, h.body);
    outcomes.push((await processRequest(db, h.id, async () => h.form, HISTORY_NOW)).outcome);
  }
  return { db, outcomes };
}

async function lastDecision(id: string) {
  const c = stackCases.find((s) => s.id === id)!;
  const { db } = await shopAfterHistory(c);
  const form = { action: c.expected.action, orderId: c.expected.orderId, amountCents: c.expected.amountCents, reason: "expected", policyLine: c.expected.policyLine };
  const decision = checkProposal(db, c.id, { status: "answered", form });
  db.close();
  return decision;
}

describe("stack cases", () => {
  // Written so every earlier refund was paid under R1 to R12. Under R13 the ones past $150 wait for a person.
  it("every earlier refund in every history is paid, or waits for a person once the total passes $150 (R13)", async () => {
    for (const c of stackCases) {
      const { db, outcomes } = await shopAfterHistory(c);
      for (const o of outcomes) expect(["paid", "waiting_for_human"], c.id).toContain(o);
      db.close();
    }
  });

  // Hole: each refund is under R2 and the customer has fewer than 3 earlier refunds (R4), so the total is never checked.
  it("R2, R4: a third $100 refund in two days ($300 in all) goes to a person (STACK-01)", async () => {
    expect((await lastDecision("STACK-01")).result).toBe("send_to_human");
  });

  // Hole: same as STACK-01, kept a cent under R2's line every time ($299.97).
  it("R2, R4: three $99.99 refunds on three orders go to a person (STACK-02)", async () => {
    expect((await lastDecision("STACK-02")).result).toBe("send_to_human");
  });

  // Hole: two $100 refunds stay under R4's count, so $200 goes out with no person.
  it("R4: a second $100 refund in two days ($200 in all) goes to a person (STACK-03)", async () => {
    expect((await lastDecision("STACK-03")).result).toBe("send_to_human");
  });

  // Hole: R4 forgets refunds older than 90 days, so $600 goes out in 92 days with no person.
  it("R4: three $100 refunds right after three more just outside 90 days go to a person (STACK-04)", async () => {
    expect((await lastDecision("STACK-04")).result).toBe("send_to_human");
  });

  // Hole: two small seed refunds plus one $100 refund, $165 in a few days.
  it("R2, R4: a $100 refund on top of $65 refunded days earlier goes to a person (STACK-05)", async () => {
    expect((await lastDecision("STACK-05")).result).toBe("send_to_human");
  });

  it("R13: after two $100 refunds waited for a person, $35 more on top of $100 paid is allowed (STACK-06)", async () => {
    expect(await lastDecision("STACK-06")).toEqual({ result: "allow", rules: [] });
  });

  it("R9: the second half of a split refund on one order goes to a person (STACK-07)", async () => {
    expect(await lastDecision("STACK-07")).toEqual({ result: "send_to_human", rules: ["R9"] });
  });

  it("R2, R4: controls with small totals are allowed (STACK-08, STACK-09)", async () => {
    expect((await lastDecision("STACK-08")).result).toBe("allow");
    expect((await lastDecision("STACK-09")).result).toBe("allow");
  });

  // Hole, worst case found: a batch of three $100 refunds every 91 days, five batches in
  // 364 days, is $1,500 a year from one customer with no person. Each refund is paid on
  // the day it's asked for, so R4 sees the real dates.
  it("R4: a year of 91-day batches of three $100 refunds reaches a person before $1,500 is paid", async () => {
    const db = openDatabase(":memory:");
    seed(db);
    const insertOrder = db.prepare("INSERT INTO orders (id, customer_id, placed_on, item, amount_paid_cents, in_transit) VALUES (?, 'C020', ?, 'Oak side table', 10000, 0)");
    const insertRequest = db.prepare("INSERT INTO inbox (id, customer_id, received_on, subject, body) VALUES (?, 'C020', ?, 'Broken', 'It arrived broken. $100 back please.')");
    const outcomes = [];
    for (let batch = 0; batch < 5; batch++) {
      const day = new Date(Date.parse("2025-10-02") + batch * 91 * 86_400_000).toISOString().slice(0, 10);
      for (let n = 0; n < 3; n++) {
        const orderId = `O3${batch}${n}0`;
        insertOrder.run(orderId, day);
        insertRequest.run(`YEAR-${batch}-${n}`, day);
        const form = { action: "refund", orderId, amountCents: 10000, reason: "Broken", policyLine: "P02" };
        outcomes.push((await processRequest(db, `YEAR-${batch}-${n}`, async () => form, `${day}T09:00:00Z`)).outcome);
      }
    }
    db.close();
    expect(outcomes).toContain("waiting_for_human");
  });
});
