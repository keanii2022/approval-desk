import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "../lib/db.ts";
import { checkProposal } from "../lib/gate.ts";
import { processRequest } from "../lib/pipeline.ts";
import { seed } from "../lib/seed.ts";

// Step 32: what the gate does when the shop's own data is wrong. Rows are written
// straight into a fresh seeded shop, then a fixed form goes through the real gate
// (and, for the holes, the whole pipeline). No AI calls.
//
// The holes found here (bad data letting money out without a person, or more than was
// paid) are now refused twice: the tables' CHECKs in lib/seed.ts turn the row away, and
// the gate's own guards cover a row that got in anyway. The hole tests switch the CHECKs
// off (unguarded) to test the gate's guards alone. See docs/DATA-TRUST.md.

let unguarded = false;

const ORDER = "O9001";
const REQUEST = "Q9001";
const PAID = 2400;

// A clean, own order for C001, asked about 4 days after it was placed: on good data
// a refund up to the amount paid is allowed and nothing more.
function shop(order: { placedOn?: string; amount?: unknown; inTransit?: unknown } = {}) {
  const db = openDatabase(":memory:");
  seed(db);
  if (unguarded) db.exec("PRAGMA ignore_check_constraints = ON");
  db.prepare("INSERT INTO orders (id, customer_id, placed_on, item, amount_paid_cents, in_transit) VALUES (?, 'C001', ?, 'Oak serving board', ?, ?)").run(
    ORDER,
    order.placedOn ?? "2026-10-01",
    ("amount" in order ? order.amount : PAID) as number,
    ("inTransit" in order ? order.inTransit : 0) as number,
  );
  db.prepare("INSERT INTO inbox (id, customer_id, received_on, subject, body) VALUES (?, 'C001', '2026-10-05', 'Cracked board', ?)").run(
    REQUEST,
    `My order ${ORDER} arrived cracked down the middle. Please refund it.`,
  );
  return db;
}

function refundForm(amountCents: number) {
  return { action: "refund", orderId: ORDER, amountCents, reason: "Arrived cracked", policyLine: "P01" };
}

function gate(db: ReturnType<typeof shop>, amountCents: number) {
  return checkProposal(db, REQUEST, { status: "answered", form: refundForm(amountCents) });
}

function addRefund(db: ReturnType<typeof shop>, amount: unknown, refundedOn = "2026-10-03") {
  db.prepare("INSERT INTO refunds (id, order_id, refunded_on, amount_cents, reason) VALUES ('RF9001', ?, ?, ?, 'earlier')").run(
    ORDER,
    refundedOn,
    amount as number,
  );
}

function rejects(write: () => void) {
  expect(write).toThrow(/constraint failed/);
}

describe("bad shop data: baseline", () => {
  it("R1: on clean data the full amount is allowed and one cent more is blocked", () => {
    const db = shop();
    expect(gate(db, PAID)).toEqual({ result: "allow", rules: [] });
    expect(gate(db, PAID + 1)).toEqual({ result: "block", rules: ["R1"] });
  });
});

describe("bad shop data: what the tables already refuse", () => {
  it("R1: an order amount that is NULL, 0 or negative can't be written", () => {
    for (const amount of [null, 0, -500]) rejects(() => shop({ amount }));
  });

  it("R1: an earlier refund that is NULL or negative can't be written, even as text like ' -500' or '-5e2'", () => {
    for (const amount of [null, -500, " -500", "-5e2"]) rejects(() => addRefund(shop(), amount));
  });

  it("R9: two refunds can't share an ID", () => {
    const db = shop();
    addRefund(db, 100);
    rejects(() => addRefund(db, 100));
  });

  it("R11: in_transit can't be NULL; R10: flagged can't be NULL", () => {
    rejects(() => shop({ inTransit: null }));
    rejects(() => shop().prepare("UPDATE customers SET flagged = NULL WHERE id = 'C001'").run());
  });

  it("R8: an order for a customer who doesn't exist, or 'c001' / 'C001 ' for C001, can't be written while foreign keys are on", () => {
    for (const customer of ["C999", "c001", "C001 "]) {
      rejects(() => shop().prepare("INSERT INTO orders VALUES ('O9002', ?, '2026-10-01', 'x', 100, 0)").run(customer));
    }
  });
});

describe("bad shop data: safe outcomes", () => {
  it("R1: earlier refunds already over the amount paid leave nothing, so any refund is blocked", () => {
    const db = shop();
    addRefund(db, PAID + 500);
    expect(gate(db, 1)).toMatchObject({ result: "block", rules: expect.arrayContaining(["R1"]) });
  });

  it("R8: with foreign keys off, an order filed under 'C001 ' or 'c001' is blocked for C001, never paid", () => {
    for (const customer of ["C001 ", "c001"]) {
      const db = shop();
      db.exec("PRAGMA foreign_keys = OFF");
      db.prepare("UPDATE orders SET customer_id = ? WHERE id = ?").run(customer, ORDER);
      expect(gate(db, 100), customer).toEqual({ result: "block", rules: ["R8"] });
    }
  });

  it("R11: a carrier status of 1 sends it to a person", () => {
    expect(gate(shop({ inTransit: 1 }), 100)).toEqual({ result: "send_to_human", rules: ["R11"] });
  });

  // Needless sends: the data is out of date in the safe direction, so a person looks
  // at something that didn't need it. The gate can't tell, and that's the right side to err on.
  it("needless send, R11: a parcel that has arrived but is still marked in transit goes to a person", () => {
    expect(gate(shop({ inTransit: 1 }), PAID).result).toBe("send_to_human");
  });

  it("needless send, R10: a flag that should have been lifted still sends it to a person", () => {
    const db = shop();
    db.prepare("UPDATE customers SET flagged = 1 WHERE id = 'C001'").run();
    expect(gate(db, 100)).toEqual({ result: "send_to_human", rules: ["R10"] });
  });
});

describe("bad shop data: the tables refuse the rows behind every hole below", () => {
  it("text amounts, odd flags and unreadable dates are turned away on write", () => {
    rejects(() => shop({ amount: "abc" }));
    rejects(() => shop({ inTransit: 2 }));
    rejects(() => shop({ inTransit: "yes" }));
    rejects(() => shop({ placedOn: "2026-13-45" }));
    rejects(() => addRefund(shop(), "-500x"));
    rejects(() => addRefund(shop(), "abc"));
    rejects(() => addRefund(shop(), 100, "2027-02-30"));
    rejects(() => shop().prepare("UPDATE customers SET flagged = 2 WHERE id = 'C001'").run());
    rejects(() => shop().prepare("UPDATE customers SET joined_on = 'recently' WHERE id = 'C001'").run());
  });
});

describe("bad shop data: holes (money out with no person, or more than was paid), with the tables' checks off", () => {
  beforeAll(() => {
    unguarded = true;
  });
  afterAll(() => {
    unguarded = false;
  });
  // HOLE, R1 and R9: the CHECK (amount_cents > 0) compares text as bigger than any
  // number, so '-500x' is stored. SUM reads it as -500, so "what's left" is
  // 2400 - (-500) = 2900, and alreadyRefunded isn't > 0, so R9 misses it too.
  // Guard: CHECK (typeof(amount_cents) = 'integer' AND amount_cents > 0).
  it("R1: a text refund amount like '-500x' can't raise what's left above what was paid", async () => {
    const db = shop();
    addRefund(db, "-500x");
    const result = await processRequest(db, REQUEST, async () => refundForm(PAID + 500), "2026-10-05T09:00:00Z");
    expect(result.outcome).not.toBe("paid");
  });

  // HOLE, R1: a text order amount passes the CHECK the same way. In the gate,
  // "abc" - 0 is NaN and amount > NaN is false, so R1 never blocks.
  // Guard: CHECK (typeof(amount_paid_cents) = 'integer' AND amount_paid_cents > 0).
  it("R1: an order whose amount isn't a number can't be refunded without a person", async () => {
    const db = shop({ amount: "abc" });
    const result = await processRequest(db, REQUEST, async () => refundForm(9_900), "2026-10-05T09:00:00Z");
    expect(result.outcome).not.toBe("paid");
  });

  // HOLE, R9: a text refund amount like 'abc' sums to 0, so the earlier refund is
  // invisible: R9 doesn't fire and R1 lets the full amount out a second time.
  it("R9: an earlier refund with an unreadable amount still makes the next one a person's call", () => {
    const db = shop();
    addRefund(db, "abc");
    expect(gate(db, PAID).result).not.toBe("allow");
  });

  // HOLE, R11: the gate checks in_transit === 1, so 2 or 'yes' reads as delivered.
  // Guard: CHECK (in_transit IN (0, 1)).
  it("R11: a carrier status of 2 or 'yes' still sends it to a person", () => {
    for (const inTransit of [2, "yes"]) expect(gate(shop({ inTransit }), 100).result, String(inTransit)).toBe("send_to_human");
  });

  // HOLE, R10: the gate checks flagged === 1, so 'true' or 2 reads as not flagged.
  // Guard: CHECK (flagged IN (0, 1)).
  it("R10: a flag stored as 'true' or 2 still sends it to a person", () => {
    for (const flagged of ["true", 2]) {
      const db = shop();
      db.prepare("UPDATE customers SET flagged = ? WHERE id = 'C001'").run(flagged);
      expect(gate(db, 100).result, String(flagged)).toBe("send_to_human");
    }
  });

  // HOLE, R3: daysBetween returns NaN for a date it can't read, and NaN > 30 is
  // false, so an unreadable or future placed_on skips R3. A future date gives a
  // negative age, which also passes. Guard: CHECK (placed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  // AND date(placed_on) = placed_on), and in the gate: an age that isn't 0 or more → person.
  it("R3: an order date the gate can't read, or one after the request, sends it to a person", () => {
    for (const placedOn of ["soon", "2026-13-45", "2027-01-01"]) {
      expect(gate(shop({ placedOn }), 100).result, placedOn).toBe("send_to_human");
    }
  });

  // HOLE, R4: an earlier refund dated in the future (or unreadable) falls outside
  // the 0-90 day window, so it isn't counted. Same date guard on refunded_on.
  it("R4: three earlier refunds still reach a person when one has a bad date", () => {
    const db = shop();
    const insert = db.prepare("INSERT INTO orders VALUES (?, 'C001', '2026-09-01', 'x', 1000, 0)");
    const refund = db.prepare("INSERT INTO refunds VALUES (?, ?, ?, 100, 'earlier')");
    for (const [i, on] of ["2026-09-10", "2026-09-20", "2027-02-01"].entries()) {
      insert.run(`O900${i + 3}`);
      refund.run(`RF900${i + 3}`, `O900${i + 3}`, on);
    }
    expect(gate(db, 100).rules).toContain("R4");
  });

  // HOLE, R10: an unreadable joined_on gives NaN days, so a new account looks old.
  it("R10: a customer whose join date can't be read is treated as new", () => {
    const db = shop();
    db.prepare("UPDATE customers SET joined_on = 'recently' WHERE id = 'C001'").run();
    expect(gate(db, 100).result).toBe("send_to_human");
  });

  // HOLE, R10 (only with foreign keys off, e.g. a file edited in the sqlite3 tool,
  // which leaves them off): a request and order filed under a customer who doesn't
  // exist pass R8, and accountNeedsALook returns false for a missing customer.
  // Guard in the gate: no customer row → person.
  it("R10: a request from a customer who doesn't exist goes to a person", () => {
    const db = shop();
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare("UPDATE orders SET customer_id = 'C999' WHERE id = ?").run(ORDER);
    db.prepare("UPDATE inbox SET customer_id = 'C999' WHERE id = ?").run(REQUEST);
    expect(gate(db, 100).result).toBe("send_to_human");
  });
});
