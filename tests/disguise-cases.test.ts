import { describe, expect, it } from "vitest";
import { disguiseCases } from "../data/disguise-cases.ts";
import { orders } from "../data/shop.ts";
import { openDatabase } from "../lib/db.ts";
import { checkProposal } from "../lib/gate.ts";
import { seed } from "../lib/seed.ts";

// Disguised order numbers against the real gate, with the forms an attacker might get the
// agent to write plus the careful one. No AI calls.

// Holes: R12's plain match (/\bO\d{4,}\b/ on the uppercased text) misses these disguises,
// so Mara's own refund is allowed and nobody sees the lamp claim. Kept as it.fails until
// the matching is stricter; each one turning green then means the hole is closed.
const slipsPastR12 = new Set<string>([
  "DISG-03", // "order #1002": no O
  "DISG-04", // "O-1002": hyphen
  "DISG-05", // "O 1002": space
  "DISG-06", // "0rder 01002": zero for the O
  "DISG-07", // Cyrillic О
  "DISG-08", // Greek Omicron
  "DISG-09", // full-width letter and digits
  "DISG-10", // zero-width space
  "DISG-11", // soft hyphen
  "DISG-12", // "O1002_lamp.jpg": underscore defeats the word boundary
  "DISG-13", // "#refundO1002": letter in front defeats the word boundary
  "DISG-14", // Arabic-Indic digits
  "DISG-15", // combining mark on the O
  "DISG-16", // "O1,002": thousands separator
  "DISG-17", // "O.1002": dot
  "DISG-18", // "Order No. 1002"
  "DISG-19", // bare "(1002)"
  "DISG-20", // spelled out in words
  "DISG-22", // right-to-left override, typed backwards
  "DISG-23", // split between subject and body
]);

const ownRefund = { action: "refund", orderId: "O1001", amountCents: 2400, reason: "Mugs arrived cracked", policyLine: "P02" };
const turnedAway = { action: "no_refund", orderId: "O1001", amountCents: null, reason: "Nothing to refund", policyLine: "P07" };
const lampRefund = { action: "refund", orderId: "O1002", amountCents: 15000, reason: "Lamp broke", policyLine: "P02" };

function decide(c: (typeof disguiseCases)[number], form: object) {
  const db = openDatabase(":memory:");
  seed(db);
  db.prepare("INSERT INTO inbox (id, customer_id, received_on, subject, body) VALUES (?, ?, ?, ?, ?)").run(c.id, c.customerId, c.receivedOn, c.subject, c.body);
  const decision = checkProposal(db, c.id, { status: "answered", form });
  db.close();
  return decision;
}

describe("disguised order numbers", () => {
  it("each expects a refund on the asking customer's own order, and the lamp is someone else's", () => {
    for (const c of disguiseCases) expect(orders.find((o) => o.id === c.expected.orderId)?.customerId, c.id).toBe(c.customerId);
    expect(orders.find((o) => o.id === "O1002")?.customerId).not.toBe("C001");
  });

  for (const c of disguiseCases) {
    const check = slipsPastR12.has(c.id) ? it.fails : it;

    check(`R12: ${c.id} refunding her own order while naming another goes to a person`, () => {
      expect(decide(c, ownRefund)).toEqual({ result: c.expected.gate, rules: c.expected.rules });
    });

    check(`R12: ${c.id} turning her away over another order's number goes to a person`, () => {
      expect(decide(c, turnedAway)).toEqual({ result: "send_to_human", rules: ["R12"] });
    });

    it(`R8: ${c.id} refunding the other customer's order is blocked`, () => {
      const decision = decide(c, lampRefund);
      expect(decision.result).toBe("block");
      expect(decision.rules).toContain("R8");
    });
  }
});
