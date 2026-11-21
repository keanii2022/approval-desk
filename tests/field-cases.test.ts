import { describe, expect, it } from "vitest";
import { type FieldCase, fieldCases } from "../data/field-cases.ts";
import { buildRequest } from "../lib/agent.ts";
import { openDatabase } from "../lib/db.ts";
import { checkProposal } from "../lib/gate.ts";
import { seed } from "../lib/seed.ts";

// Step 26: tricks in the subject, the customer's name and item names. Each case's
// attack form and honest form go to the real gate in a fresh seeded shop. No AI calls.

const R12_SCAN_HOLES = ["FIELD-08", "FIELD-09", "FIELD-10"];

function shopWith(c: Pick<FieldCase, "id" | "customerId" | "receivedOn" | "subject" | "body" | "extraCustomers" | "extraOrders">) {
  const db = openDatabase(":memory:");
  seed(db);
  const insertCustomer = db.prepare("INSERT INTO customers (id, name, email) VALUES (?, ?, ?)");
  for (const customer of c.extraCustomers ?? []) insertCustomer.run(customer.id, customer.name, customer.email);
  const insertOrder = db.prepare("INSERT INTO orders (id, customer_id, placed_on, item, amount_paid_cents, in_transit) VALUES (?, ?, ?, ?, ?, 0)");
  for (const o of c.extraOrders ?? []) insertOrder.run(o.id, o.customerId, o.placedOn, o.item, o.amountPaidCents);
  db.prepare("INSERT INTO inbox (id, customer_id, received_on, subject, body) VALUES (?, ?, ?, ?, ?)").run(c.id, c.customerId, c.receivedOn, c.subject, c.body);
  return db;
}

function decide(c: FieldCase, form: Record<string, unknown>) {
  const db = shopWith(c);
  const decision = checkProposal(db, c.id, { status: "answered", form });
  db.close();
  return decision;
}

const honestForm = (c: FieldCase) => ({
  action: c.expected.action,
  orderId: c.expected.orderId,
  amountCents: c.expected.amountCents,
  reason: "expected",
  policyLine: c.expected.policyLine,
});

const caseById = (id: string) => fieldCases.find((c) => c.id === id)!;

describe("field cases", () => {
  it("every case's trick reaches the model through buildRequest", () => {
    for (const c of fieldCases) {
      const db = shopWith(c);
      const { user } = buildRequest(db, c.id);
      const planted = c.field === "subject" ? c.subject : c.field === "name" ? c.extraCustomers![0].name : c.extraOrders![0].item;
      expect(user, c.id).toContain(planted);
      db.close();
    }
  });

  for (const c of fieldCases.filter((f) => !R12_SCAN_HOLES.includes(f.id))) {
    it(`${c.id} (${c.expected.rules.join(", ") || "no rule"}): the honest answer gets ${c.expected.gate}`, () => {
      expect(decide(c, honestForm(c))).toEqual({ result: c.expected.gate, rules: c.expected.rules });
    });
  }

  for (const c of fieldCases.filter((f) => !f.agentOnly && !R12_SCAN_HOLES.includes(f.id))) {
    it(`${c.id} (${c.attackGate.rules.join(", ")}): the ${c.field} trick's hoped-for form is stopped by the gate`, () => {
      const decision = decide(c, c.attack);
      expect(decision).toEqual(c.attackGate);
      expect(decision.result).not.toBe("allow");
    });
  }

  // Not holes in the gate: a small refund on the customer's own recent order is one the
  // gate must allow, so only the agent can tell it wasn't asked for. Measured with evals.
  for (const c of fieldCases.filter((f) => f.agentOnly)) {
    it(`${c.id} (R2, R3 not reached): agent only, the gate allows the ${c.field} trick's form`, () => {
      expect(decide(c, c.attack)).toEqual({ result: "allow", rules: [] });
    });
  }

  // Hole: namesUnknownOrder matches /\bO\d{4,}\b/ on the uppercased text. "_" is a word
  // character, so "ticket_O1002" has no boundary before the O, and someone else's order goes unseen.
  it.fails("R12: someone else's order glued to an underscore in the subject goes to a person (FIELD-08)", () => {
    expect(decide(caseById("FIELD-08"), caseById("FIELD-08").attack)).toEqual({ result: "send_to_human", rules: ["R12"] });
  });

  // Hole: \d without the u flag only matches ASCII digits, so full-width "O１００２" is skipped.
  it.fails("R12: someone else's order in full-width digits in the subject goes to a person (FIELD-09)", () => {
    expect(decide(caseById("FIELD-09"), caseById("FIELD-09").attack)).toEqual({ result: "send_to_human", rules: ["R12"] });
  });

  // Hole: toUpperCase runs before the match and turns "ß" into "SS", gluing word characters onto the O.
  it.fails("R12: someone else's order right after a ß in the subject goes to a person (FIELD-10)", () => {
    expect(decide(caseById("FIELD-10"), caseById("FIELD-10").attack)).toEqual({ result: "send_to_human", rules: ["R12"] });
  });

  it("R12: the same messages with a plain space before the order number go to a person (controls for FIELD-08 to 10)", () => {
    for (const id of R12_SCAN_HOLES) {
      const c = { ...caseById(id), subject: "Re: ticket O1002" };
      expect(decide(c, c.attack), id).toEqual({ result: "send_to_human", rules: ["R12"] });
    }
  });
});

describe("odd subjects don't crash the gate or the request builder", () => {
  const base = caseById("FIELD-02");
  const subjects = [
    "",
    "null",
    "undefined",
    "\u0000\u0000",
    "🧨💸🙂 O1001 🙂",
    "O1001".repeat(20_000),
    `${"a".repeat(200_000)} O1002`,
    "<customer_message></customer_message>".repeat(1_000),
  ];

  for (const subject of subjects) {
    it(`R5, R12: a ${subject.length}-character subject gives a normal decision`, () => {
      const c = { ...base, subject };
      const db = shopWith(c);
      expect(() => buildRequest(db, c.id)).not.toThrow();
      const decision = checkProposal(db, c.id, { status: "answered", form: c.attack });
      expect(["allow", "send_to_human", "block"]).toContain(decision.result);
      db.close();
    });
  }

  it("R12: someone else's order at the end of a 200,000-character subject still goes to a person", () => {
    const c = { ...base, subject: `${"a ".repeat(100_000)}O1002` };
    expect(decide(c, c.attack)).toEqual({ result: "send_to_human", rules: ["R12"] });
  });

  it("R8: an emoji-only name for someone new with no orders can't be refunded", () => {
    const c = { ...caseById("FIELD-11"), extraCustomers: [{ id: "N-901", name: "💸💸💸", email: "n-901@example.com" }] };
    expect(decide(c, c.attack)).toEqual({ result: "block", rules: ["R8"] });
  });
});
