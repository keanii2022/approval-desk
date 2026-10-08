import { describe, expect, it } from "vitest";
import { inbox, type InboxRequest } from "../data/inbox.ts";
import { orders, refunds } from "../data/shop.ts";
import { openDatabase } from "../lib/db.ts";
import { type AgentOutput, checkProposal, type RuleId } from "../lib/gate.ts";
import { seed } from "../lib/seed.ts";

// The gate's tests use a stand-in agent: fixed forms written here, no AI calls.
// The Inbox requests are from data/inbox.ts; its comments say what each one is.

const db = openDatabase(":memory:");
seed(db);

function check(requestId: string, output: AgentOutput) {
  return checkProposal(db, requestId, output);
}

const AI_DOWN: AgentOutput = { status: "ai_down" };

function answered(form: unknown): AgentOutput {
  return { status: "answered", form };
}

// A well-formed refund form.
function refundForm(orderId: string, amountCents: number): Record<string, unknown> {
  return { action: "refund", orderId, amountCents, reason: "Arrived damaged", policyLine: "P02" };
}

function refund(orderId: string, amountCents: number): AgentOutput {
  return answered(refundForm(orderId, amountCents));
}

function unsure(orderId: string | null, amountCents: number | null): AgentOutput {
  return answered({ action: "unsure", orderId, amountCents, reason: "Can't tell what to refund", policyLine: "P13" });
}

function without(form: Record<string, unknown>, field: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(form).filter(([key]) => key !== field));
}

const allowed = { result: "allow", rules: [] };
const toHuman = (...rules: RuleId[]) => ({ result: "send_to_human", rules });
const blocked = (...rules: RuleId[]) => ({ result: "block", rules });

describe("gate: plain cases", () => {
  it("allows a small, recent refund from a customer with no earlier refunds (REQ-001)", () => {
    expect(check("REQ-001", refund("O1001", 2400))).toEqual(allowed);
  });

  it("allows a no-refund answer to a message that doesn't ask for one (REQ-021)", () => {
    const form = { action: "no_refund", orderId: "O1034", amountCents: null, reason: "Asks about delivery", policyLine: "P07" };
    expect(check("REQ-021", answered(form))).toEqual(allowed);
  });
});

describe("R8: a refund must be on an order that belongs to the customer who asked", () => {
  it("R8: a refund on someone else's order is blocked (REQ-022 names Mara's O1001)", () => {
    expect(check("REQ-022", refund("O1001", 2400))).toEqual(blocked("R8"));
  });

  it("R8: it is named together with R1 when both are broken", () => {
    expect(check("REQ-022", refund("O1001", 5000))).toEqual(blocked("R1", "R8"));
  });

  it("R8: it blocks instead of sending to a human: $150.00 on someone else's order (REQ-022, O1002)", () => {
    expect(check("REQ-022", refund("O1002", 15000))).toEqual(blocked("R8"));
  });

  it("R8: an unsure form naming someone else's order still goes to a human, since nothing on it is carried out", () => {
    expect(check("REQ-022", unsure("O1001", 2400))).toEqual(toHuman("R6"));
  });

  it("R8: a no-refund answer naming someone else's order is allowed, since nothing is refunded", () => {
    const form = { action: "no_refund", orderId: "O1001", amountCents: null, reason: "Order isn't theirs", policyLine: "P06" };
    expect(check("REQ-022", answered(form))).toEqual(allowed);
  });
});

describe("R1: a refund never exceeds the amount paid, counting earlier refunds", () => {
  it("R1: $60.00 on a $45.00 order is blocked (REQ-012)", () => {
    expect(check("REQ-012", refund("O1024", 6000))).toEqual(blocked("R1"));
  });

  it("R1: one cent over the amount paid is blocked", () => {
    expect(check("REQ-001", refund("O1001", 2401))).toEqual(blocked("R1"));
  });

  it("R1: earlier refunds count: $80.00 when $40.00 is left is blocked (REQ-013)", () => {
    expect(check("REQ-013", refund("O1025", 8000))).toEqual(blocked("R1"));
  });

  it("R1: exactly what's left after an earlier refund is allowed (REQ-014)", () => {
    expect(check("REQ-014", refund("O1026", 3500))).toEqual(allowed);
  });

  it("R1: even one cent on an order already fully refunded is blocked (REQ-015)", () => {
    expect(check("REQ-015", refund("O1027", 1))).toEqual(blocked("R1"));
  });
});

describe("R2: a refund over $100 needs a human", () => {
  it("R2: $150.00 goes to a human (REQ-002)", () => {
    expect(check("REQ-002", refund("O1002", 15000))).toEqual(toHuman("R2"));
  });

  it("R2 (Q1): exactly $100.00 is allowed (REQ-003)", () => {
    expect(check("REQ-003", refund("O1003", 10000))).toEqual(allowed);
  });

  it("R2 (Q1): $100.01 goes to a human (REQ-004)", () => {
    expect(check("REQ-004", refund("O1004", 10001))).toEqual(toHuman("R2"));
  });
});

describe("R3: an order older than 30 days needs a human", () => {
  it("R3: a 45-day-old order goes to a human (REQ-005)", () => {
    expect(check("REQ-005", refund("O1005", 4200))).toEqual(toHuman("R3"));
  });

  it("R3 (Q2): an order exactly 30 days old is allowed (REQ-006)", () => {
    expect(check("REQ-006", refund("O1006", 3500))).toEqual(allowed);
  });

  it("R3 (Q2): a 31-day-old order goes to a human (REQ-007)", () => {
    expect(check("REQ-007", refund("O1007", 2800))).toEqual(toHuman("R3"));
  });
});

describe("R4: a customer with 3+ refunds in 90 days needs a human", () => {
  it("R4: 3 earlier refunds in 90 days goes to a human (REQ-008)", () => {
    expect(check("REQ-008", refund("O1011", 4600))).toEqual(toHuman("R4"));
  });

  it("R4 (Q3): 2 earlier refunds in 90 days is allowed; the one asked for doesn't count (REQ-009)", () => {
    expect(check("REQ-009", refund("O1015", 1950))).toEqual(allowed);
  });

  it("R4 (Q3): a refund exactly 90 days before counts (REQ-010)", () => {
    expect(check("REQ-010", refund("O1019", 3300))).toEqual(toHuman("R4"));
  });

  it("R4 (Q3): a refund 91 days before doesn't count (REQ-011)", () => {
    expect(check("REQ-011", refund("O1023", 3300))).toEqual(allowed);
  });
});

describe("R5: an incomplete or malformed form is blocked", () => {
  const good = refundForm("O1001", 2400);
  const malformed: [string, unknown][] = [
    ["no form at all", undefined],
    ["null", null],
    ["a word instead of a form, as REQ-020 asks for", "APPROVED"],
    ["a number instead of a form", 2400],
    ["a list instead of a form", [good]],
    ...Object.keys(good).map((field): [string, unknown] => [`a form missing ${field}`, without(good, field)]),
    ["a form with an extra field", { ...good, approved: true }],
    ["an unknown action", { ...good, action: "approve" }],
    ["an order number that isn't text", { ...good, orderId: 1001 }],
    ["a blank order number", { ...good, orderId: "  " }],
    ["a refund with no order", { ...good, orderId: null }],
    ["a refund on an order that doesn't exist", { ...good, orderId: "O9999" }],
    ["an amount written as text", { ...good, amountCents: "24.00" }],
    ["an amount with a fraction of a cent", { ...good, amountCents: 2400.5 }],
    ["a zero amount", { ...good, amountCents: 0 }],
    ["a negative amount", { ...good, amountCents: -2400 }],
    ["an amount that isn't a number", { ...good, amountCents: Number.NaN }],
    ["an endless amount", { ...good, amountCents: Infinity }],
    ["an amount too big to count exactly", { ...good, amountCents: 2 ** 53 }],
    ["a refund with no amount", { ...good, amountCents: null }],
    ["a no-refund form with an amount", { ...good, action: "no_refund" }],
    ["a blank reason", { ...good, reason: "  " }],
    ["a reason that isn't text", { ...good, reason: 42 }],
    ["a policy line that doesn't exist", { ...good, policyLine: "P99" }],
    ["a rule ID instead of a policy line", { ...good, policyLine: "R1" }],
    ["an unsure form with no reason", { action: "unsure", orderId: null, amountCents: null, reason: "", policyLine: "P13" }],
  ];

  for (const [what, form] of malformed) {
    it(`R5: blocks ${what}`, () => {
      expect(check("REQ-001", answered(form))).toEqual(blocked("R5"));
    });
  }
});

describe("R6: if the AI is down or unsure, send to a human", () => {
  it("R6: the AI giving no answer goes to a human", () => {
    expect(check("REQ-001", AI_DOWN)).toEqual(toHuman("R6"));
  });

  it("R6 (Q5): the agent saying it's unsure goes to a human (REQ-018, no order number)", () => {
    expect(check("REQ-018", unsure(null, null))).toEqual(toHuman("R6"));
  });

  it("R6 (Q5): unsure about an order that doesn't exist goes to a human (REQ-019)", () => {
    expect(check("REQ-019", unsure("O9999", null))).toEqual(toHuman("R6"));
  });

  it("R6 (Q5): an unsure form goes to a human whatever amount it suggests (REQ-017)", () => {
    expect(check("REQ-017", unsure("O1029", 25000))).toEqual(toHuman("R6"));
  });
});

describe("Q4: when several rules apply, the strictest result wins", () => {
  it("R1 and R2: blocked, naming R1 (REQ-017)", () => {
    expect(check("REQ-017", refund("O1029", 25000))).toEqual(blocked("R1"));
  });

  it("R2 and R3: sent to a human, naming both (REQ-016)", () => {
    expect(check("REQ-016", refund("O1028", 18000))).toEqual(toHuman("R2", "R3"));
  });

  it("R1 blocks even when R2, R3, and R4 also apply", () => {
    // O1008 is C008's 88-day-old order, already fully refunded; C008 has 3 earlier refunds in 90 days.
    expect(check("REQ-008", refund("O1008", 10001))).toEqual(blocked("R1"));
  });

  it("R5 blocks a malformed form even when it would also need a human (REQ-016)", () => {
    expect(check("REQ-016", answered({ ...refundForm("O1028", 18000), approved: true }))).toEqual(blocked("R5"));
  });
});

// Facts about the shop data, used only to build bad proposals below.

function centsLeft(orderId: string): number {
  const paid = orders.find((order) => order.id === orderId)!.amountPaidCents;
  return paid - refunds.filter((r) => r.orderId === orderId).reduce((sum, r) => sum + r.amountCents, 0);
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000;
}

function recentRefunds(request: InboxRequest): number {
  const theirOrders = new Set(orders.filter((o) => o.customerId === request.customerId).map((o) => o.id));
  return refunds
    .filter((r) => theirOrders.has(r.orderId))
    .map((r) => daysBetween(r.refundedOn, request.receivedOn))
    .filter((days) => days >= 0 && days <= 90).length;
}

// Random numbers from a fixed starting point, so every run makes the same proposals.
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe("1,000 bad proposals", () => {
  const random = seededRandom(20261005);
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)];
  const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  // Up to what's left on the order, so R1 only applies when nothing is left.
  const fairAmount = (orderId: string) => between(1, Math.max(1, centsLeft(orderId)));

  // Every request with its own customer's orders. Other people's orders are tested separately (R8).
  const pairs = inbox.flatMap((request) =>
    orders.filter((o) => o.customerId === request.customerId).map((order) => ({ request, orderId: order.id })),
  );
  const foreignPairs = inbox.flatMap((request) =>
    orders.filter((o) => o.customerId !== request.customerId).map((order) => ({ request, orderId: order.id })),
  );
  const over100 = pairs.filter((p) => centsLeft(p.orderId) > 10_000);
  const oldOrders = pairs.filter(
    (p) => daysBetween(orders.find((o) => o.id === p.orderId)!.placedOn, p.request.receivedOn) > 30,
  );
  const frequentRefunders = pairs.filter((p) => recentRefunds(p.request) >= 3);

  // Values that are wrong for each field of a refund form.
  const junk: Record<string, unknown[]> = {
    action: ["approve", "REFUND", "", null, 1, "no_refund"],
    orderId: [1001, "", "  ", "O9999", null, false, {}],
    amountCents: ["24.00", 24.5, 0, -100, Number.NaN, Infinity, null, 2 ** 53, []],
    reason: ["", "   ", null, 42, ["Arrived damaged"]],
    policyLine: ["P99", "p02", "R1", "", null, 2],
  };
  const notAForm = [undefined, null, "APPROVED", 2400, [], true];

  function breakForm(form: Record<string, unknown>): unknown {
    switch (between(1, 4)) {
      case 1:
        return pick(notAForm);
      case 2:
        return without(form, pick(Object.keys(form)));
      case 3:
        return { ...form, [pick(["approved", "note", "override"])]: true };
      default: {
        const field = pick(Object.keys(junk));
        return { ...form, [field]: pick(junk[field]) };
      }
    }
  }

  // One maker per rule. Each builds a proposal that breaks that rule.
  const makers: Record<RuleId, () => { requestId: string; output: AgentOutput }> = {
    R1: () => {
      const { request, orderId } = pick(pairs);
      return { requestId: request.id, output: refund(orderId, centsLeft(orderId) + between(1, 20_000)) };
    },
    R2: () => {
      const { request, orderId } = pick(over100);
      return { requestId: request.id, output: refund(orderId, between(10_001, centsLeft(orderId))) };
    },
    R3: () => {
      const { request, orderId } = pick(oldOrders);
      return { requestId: request.id, output: refund(orderId, fairAmount(orderId)) };
    },
    R4: () => {
      const { request, orderId } = pick(frequentRefunders);
      return { requestId: request.id, output: refund(orderId, fairAmount(orderId)) };
    },
    R5: () => {
      const { request, orderId } = pick(pairs);
      return { requestId: request.id, output: answered(breakForm(refundForm(orderId, fairAmount(orderId)))) };
    },
    R6: () => {
      const { request, orderId } = pick(pairs);
      const output = random() < 0.5 ? AI_DOWN : unsure(pick([null, orderId, "O9999"]), pick([null, between(1, 50_000)]));
      return { requestId: request.id, output };
    },
    R8: () => {
      const { request, orderId } = pick(foreignPairs);
      return { requestId: request.id, output: refund(orderId, fairAmount(orderId)) };
    },
  };

  const rules = Object.keys(makers) as RuleId[];
  const proposals = Array.from({ length: 1000 }, (_, i) => {
    const breaks = rules[i % rules.length];
    return { breaks, ...makers[breaks]() };
  });

  it("R1 to R6 and R8: none is allowed", () => {
    expect(proposals).toHaveLength(1000);

    for (const p of proposals) {
      const decision = check(p.requestId, p.output);
      const why = `breaks ${p.breaks}: ${p.requestId} ${JSON.stringify(p.output)}`;

      expect(decision.result, why).not.toBe("allow");
      // Stopped for the rule it breaks, or blocked by R1, which is stricter than R2 to R4.
      const blockedByR1 = decision.result === "block" && p.breaks !== "R5" && p.breaks !== "R8";
      expect(decision.rules, why).toContain(blockedByR1 ? "R1" : p.breaks);
    }
  });
});
