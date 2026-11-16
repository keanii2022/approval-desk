import { describe, expect, it } from "vitest";
import { hardCaseDrafts, hardCases } from "../data/hard-cases.ts";
import { customers, orders, refunds } from "../data/shop.ts";
import type { AskModel, ModelRequest } from "../lib/agent.ts";
import { runEvals } from "../lib/evals.ts";

// The hard set is data, and these are facts about that data: every case points
// at real shop data, and no right answer breaks the policy. No AI is called.

const customerIds = new Set(customers.map((c) => c.id));
const orderById = new Map(orders.map((o) => [o.id, o]));
const leftOn = (orderId: string) =>
  orderById.get(orderId)!.amountPaidCents - refunds.filter((r) => r.orderId === orderId).reduce((sum, r) => sum + r.amountCents, 0);

describe("hard set", () => {
  it("has 60 cases with unique ids in order, at least 25 of them tricky", () => {
    expect(hardCases).toHaveLength(60);
    expect(hardCases.map((c) => c.id)).toEqual(hardCases.map((_, i) => `HARD-${String(i + 1).padStart(3, "0")}`));
    expect(hardCases.filter((c) => c.tricky).length).toBeGreaterThanOrEqual(25);
  });

  it("every message comes from a real customer, sent between 2026-09-25 and 2026-10-05", () => {
    for (const c of hardCases) {
      expect(customerIds.has(c.customerId), `${c.id}: customer`).toBe(true);
      expect(c.receivedOn >= "2026-09-25" && c.receivedOn <= "2026-10-05", `${c.id}: date ${c.receivedOn}`).toBe(true);
    }
  });

  it("R8: a refund answer is only ever on the asking customer's own, real order", () => {
    for (const c of hardCases.filter((c) => c.expected.action === "refund")) {
      expect(orderById.get(c.expected.orderId!)?.customerId, `${c.id}: owner of ${c.expected.orderId}`).toBe(c.customerId);
    }
  });

  it("R1: no refund answer is more than what's left on the order, counting earlier refunds", () => {
    for (const c of hardCases.filter((c) => c.expected.action === "refund")) {
      const amount = c.expected.amountCents!;
      expect(Number.isInteger(amount) && amount > 0, `${c.id}: amount`).toBe(true);
      expect(amount, `${c.id}: ${amount} cents vs ${leftOn(c.expected.orderId!)} left`).toBeLessThanOrEqual(leftOn(c.expected.orderId!));
    }
  });

  it("the gate never blocks a right answer, and each case keeps the right answer it was written with", () => {
    for (const c of hardCases) expect(c.expected.gate, c.id).not.toBe("block");
    expect(hardCases.map((c) => c.expected.action)).toEqual(hardCaseDrafts.map((d) => d.expected.action));
  });

  it("an agent that gives every right answer scores 100% on the hard set", async () => {
    const perfect: AskModel = async ({ user }: ModelRequest) => {
      const id = /Request (HARD-\d+)/.exec(user)![1];
      const e = hardCases.find((c) => c.id === id)!.expected;
      return { action: e.action, orderId: e.orderId, amountCents: e.amountCents, reason: "expected", policyLine: e.policyLine };
    };
    const card = await runEvals(perfect, { model: "stand-in", set: "hard", cases: hardCases, runs: 1, now: () => "2026-11-16T12:00:00Z" });
    expect(card.accuracy).toBe(1);
    expect(card.set).toBe("hard");
  });
});
