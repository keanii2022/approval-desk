import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { amountCases } from "../data/amount-cases.ts";
import { orders } from "../data/shop.ts";
import { openDatabase } from "../lib/db.ts";
import { checkProposal } from "../lib/gate.ts";
import { seed } from "../lib/seed.ts";

// Amount tricks against the real gate. No AI calls.
// Wording: the right answer and each likely misread go through a fresh seeded shop.
// Malformed: amounts the gate must refuse by plain code (R5) or cap (R1).

function shopWith(id: string, customerId: string, receivedOn: string, subject: string, body: string): DatabaseSync {
  const db = openDatabase(":memory:");
  seed(db);
  db.prepare("INSERT INTO inbox (id, customer_id, received_on, subject, body) VALUES (?, ?, ?, ?, ?)").run(id, customerId, receivedOn, subject, body);
  return db;
}

function gateFor(c: (typeof amountCases)[number], amountCents: number) {
  const db = shopWith(c.id, c.customerId, c.receivedOn, c.subject, c.body);
  const form = { action: "refund", orderId: c.expected.orderId, amountCents, reason: "amount test", policyLine: c.expected.policyLine };
  const decision = checkProposal(db, c.id, { status: "answered", form });
  db.close();
  return decision;
}

describe("amount tricks: wording", () => {
  it("each expects a refund on the asking customer's own order, in whole cents, never over the price paid", () => {
    for (const c of amountCases) {
      const order = orders.find((o) => o.id === c.expected.orderId);
      expect(order?.customerId, c.id).toBe(c.customerId);
      expect(Number.isSafeInteger(c.expected.amountCents), c.id).toBe(true);
      expect(c.expected.amountCents, c.id).toBeLessThanOrEqual(order!.amountPaidCents);
    }
  });

  for (const c of amountCases) {
    it(`${c.id}: ${c.expected.rules.join(", ") || "R1, R2"}: the right amount gets the expected result`, () => {
      expect(gateFor(c, c.expected.amountCents)).toEqual({ result: c.expected.gate, rules: c.expected.rules });
    });

    for (const m of c.misreads) {
      it(`${c.id}: ${m.rules.join(", ") || "R1, R2"}: misread "${m.says}" gets ${m.gate}`, () => {
        expect(gateFor(c, m.amountCents)).toEqual({ result: m.gate, rules: m.rules });
      });
    }
  }

  // Misreads that pay more than the right answer and that the gate allows: only the agent stops these.
  it("R1: the overpaying misreads the gate can't catch are exactly these (agent-only risk)", () => {
    const overpays = amountCases.flatMap((c) =>
      c.misreads.filter((m) => m.gate === "allow" && m.amountCents > c.expected.amountCents!).map((m) => `${c.id}: ${m.says}`),
    );
    expect(overpays).toEqual([
      "AMT-04: £20 read as $20",
      "AMT-07: the full price",
      "AMT-10: rounded up to $9.34",
      "AMT-10: the whole set",
      "AMT-11: $12 plus $4.99 shipping",
    ]);
  });
});

describe("amount tricks: malformed forms", () => {
  // Mara's $24.00 mugs (O1001), nothing refunded, nothing else in play: the only rules that can fire are R1, R2 and R5.
  const request = { id: "AMT-FORM", customerId: "C001", receivedOn: "2026-10-01", subject: "Mugs broken", body: "All four mugs arrived broken. Mara" };
  const check = (fields: Record<string, unknown>) => {
    const db = shopWith(request.id, request.customerId, request.receivedOn, request.subject, request.body);
    const form = { action: "refund", orderId: "O1001", amountCents: 2400, reason: "amount test", policyLine: "P02", ...fields };
    const decision = checkProposal(db, request.id, { status: "answered", form });
    db.close();
    return decision;
  };
  const blocked = (rule: "R1" | "R5") => ({ result: "block", rules: [rule] });

  it("control: the full $24.00 is allowed, and so is one cent", () => {
    expect(check({})).toEqual({ result: "allow", rules: [] });
    expect(check({ amountCents: 1 })).toEqual({ result: "allow", rules: [] });
  });

  it("R5: a refund of zero is blocked", () => expect(check({ amountCents: 0 })).toEqual(blocked("R5")));
  it("R5: a negative refund is blocked", () => expect(check({ amountCents: -2400 })).toEqual(blocked("R5")));
  it("R5: minus zero is blocked", () => expect(check({ amountCents: -0 })).toEqual(blocked("R5")));
  it("R5: a fraction of a cent is blocked", () => expect(check({ amountCents: 2400.5 })).toEqual(blocked("R5")));
  it("R5: the amount as a string is blocked", () => expect(check({ amountCents: "2400" })).toEqual(blocked("R5")));
  it("R5: an amount in exponent string form is blocked", () => expect(check({ amountCents: "1e3" })).toEqual(blocked("R5")));
  it("R5: NaN is blocked", () => expect(check({ amountCents: Number.NaN })).toEqual(blocked("R5")));
  it("R5: Infinity is blocked", () => expect(check({ amountCents: Number.POSITIVE_INFINITY })).toEqual(blocked("R5")));
  it("R5: minus Infinity is blocked", () => expect(check({ amountCents: Number.NEGATIVE_INFINITY })).toEqual(blocked("R5")));
  it("R5: a number past the safe integer range is blocked", () => expect(check({ amountCents: Number.MAX_SAFE_INTEGER + 2 })).toEqual(blocked("R5")));
  it("R5: a BigInt is blocked", () => expect(check({ amountCents: 2400n })).toEqual(blocked("R5")));
  it("R5: a boxed Number is blocked", () => expect(check({ amountCents: new Number(2400) })).toEqual(blocked("R5")));
  it("R5: an amount wrapped in a list is blocked", () => expect(check({ amountCents: [2400] })).toEqual(blocked("R5")));
  it("R5: an amount as an object with a value is blocked", () => expect(check({ amountCents: { value: 2400 } })).toEqual(blocked("R5")));
  it("R5: a refund with no amount is blocked", () => expect(check({ amountCents: null })).toEqual(blocked("R5")));
  it("R5: no_refund carrying an amount is blocked", () => expect(check({ action: "no_refund" })).toEqual(blocked("R5")));
  it("R5: unsure with an amount of zero is blocked, not passed on as a hint", () =>
    expect(check({ action: "unsure", amountCents: 0 })).toEqual(blocked("R5")));

  it("R1: one cent over the price paid is blocked", () => expect(check({ amountCents: 2401 })).toEqual(blocked("R1")));
  it("R1: a billion cents is blocked", () => expect(check({ amountCents: 1e9 })).toEqual(blocked("R1")));
  it("R1: the largest safe integer is blocked", () => expect(check({ amountCents: Number.MAX_SAFE_INTEGER })).toEqual(blocked("R1")));

  // An amount that reads 2400 the first time and a million after. The gate reads it once, so its checks
  // agree with each other. Not reachable today: the agent's form comes from JSON, which has no getters.
  it("R1: an amount that changes after it's read is judged on one reading", () => {
    let reads = 0;
    const db = shopWith(request.id, request.customerId, request.receivedOn, request.subject, request.body);
    const form = { action: "refund", orderId: "O1001", reason: "amount test", policyLine: "P02" } as Record<string, unknown>;
    Object.defineProperty(form, "amountCents", { enumerable: true, get: () => (reads++ === 0 ? 2400 : 100_000_000) });
    expect(checkProposal(db, request.id, { status: "answered", form })).toEqual({ result: "allow", rules: [] });
    db.close();
  });
});
