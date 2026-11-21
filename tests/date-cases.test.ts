import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { dateCases } from "../data/date-cases.ts";
import { openDatabase } from "../lib/db.ts";
import { checkProposal } from "../lib/gate.ts";
import { processRequest } from "../lib/pipeline.ts";
import { seed } from "../lib/seed.ts";

// Step 28: date oddities. Each case's right answer goes to the real gate, on a fresh
// seeded shop with odd rows inserted straight into it where needed. No AI calls.

function freshShop(): DatabaseSync {
  const db = openDatabase(":memory:");
  seed(db);
  return db;
}

const refundForm = (orderId: string, amountCents: number) => ({ action: "refund", orderId, amountCents, reason: "Damaged", policyLine: "P02" });

function addRequest(db: DatabaseSync, id: string, customerId: string, receivedOn: string) {
  db.prepare("INSERT INTO inbox (id, customer_id, received_on, subject, body) VALUES (?, ?, ?, 'Damaged', 'It arrived damaged. Refund please.')").run(id, customerId, receivedOn);
}

function addOrder(db: DatabaseSync, id: string, customerId: string, placedOn: string, amountPaidCents = 3000) {
  db.prepare("INSERT INTO orders (id, customer_id, placed_on, item, amount_paid_cents, in_transit) VALUES (?, ?, ?, 'Oak side table', ?, 0)").run(id, customerId, placedOn, amountPaidCents);
}

// The gate's answer to a refund of the given order, asked on the given day.
function decideOn(db: DatabaseSync, customerId: string, receivedOn: string, orderId: string, amountCents: number) {
  const id = `ODD-${Math.random().toString(36).slice(2, 10)}`;
  addRequest(db, id, customerId, receivedOn);
  return checkProposal(db, id, { status: "answered", form: refundForm(orderId, amountCents) });
}

function caseDecision(id: string) {
  const c = dateCases.find((d) => d.id === id)!;
  const db = freshShop();
  const decision = decideOn(db, c.customerId, c.receivedOn, c.expected.orderId!, c.expected.amountCents!);
  db.close();
  return decision;
}

describe("date cases the agent sees", () => {
  it("R3: a month-end request exactly 30 days after the order is allowed (DATE-01, DATE-03)", () => {
    expect(caseDecision("DATE-01")).toEqual({ result: "allow", rules: [] });
    expect(caseDecision("DATE-03")).toEqual({ result: "allow", rules: [] });
  });

  it("R3: a month-end request 31 days after the order goes to a person (DATE-02, DATE-04)", () => {
    expect(caseDecision("DATE-02")).toEqual({ result: "send_to_human", rules: ["R3"] });
    expect(caseDecision("DATE-04")).toEqual({ result: "send_to_human", rules: ["R3"] });
  });

  // Hole: the order's age is negative, and R3 only looks for more than 30, so a refund on an order placed after the request is paid.
  it.fails("R3: a request received before its order was placed goes to a person (DATE-05)", () => {
    expect(caseDecision("DATE-05").result).toBe("send_to_human");
  });

  // Hole: R10 counts only 0 to 30 days, so an account opened after the request looks long-standing.
  it.fails("R3, R10: a request received before the account was opened goes to a person (DATE-06)", () => {
    expect(caseDecision("DATE-06").result).toBe("send_to_human");
  });
});

describe("leap days and month ends", () => {
  it("R3: Feb 29 2028 counts as a day on both sides of the 30-day line", () => {
    const db = freshShop();
    addOrder(db, "O5001", "C012", "2028-01-30");
    addOrder(db, "O5002", "C012", "2028-01-29");
    addOrder(db, "O5003", "C012", "2028-02-29");
    expect(decideOn(db, "C012", "2028-02-29", "O5001", 3000).result).toBe("allow");
    expect(decideOn(db, "C012", "2028-02-29", "O5002", 3000)).toEqual({ result: "send_to_human", rules: ["R3"] });
    expect(decideOn(db, "C012", "2028-03-30", "O5003", 3000).result).toBe("allow");
    expect(decideOn(db, "C012", "2028-03-31", "O5003", 3000)).toEqual({ result: "send_to_human", rules: ["R3"] });
    db.close();
  });

  it("R3: Dec 31 to Jan 30 across the year end is 30 days, Jan 31 is 31", () => {
    const db = freshShop();
    addOrder(db, "O5004", "C012", "2026-12-31");
    expect(decideOn(db, "C012", "2027-01-30", "O5004", 3000).result).toBe("allow");
    expect(decideOn(db, "C012", "2027-01-31", "O5004", 3000)).toEqual({ result: "send_to_human", rules: ["R3"] });
    db.close();
  });

  it("R3: a request on Nov 4 about an order from Oct 5 is 30 days, US clock change or not", () => {
    const db = freshShop();
    addOrder(db, "O5005", "C012", "2026-10-05");
    expect(decideOn(db, "C012", "2026-11-04", "O5005", 3000).result).toBe("allow");
    expect(decideOn(db, "C012", "2026-11-05", "O5005", 3000)).toEqual({ result: "send_to_human", rules: ["R3"] });
    db.close();
  });
});

// No code path writes these today: the pipeline, evals and the try page all store
// YYYY-MM-DD. The inbox column is plain TEXT with no check, so a row inserted any
// other way reaches the gate as it is.
describe("received_on in another shape", () => {
  // Hole: a month 13 parses to NaN, NaN > 30 is false, and a 66-day-old order is paid.
  it.fails("R3: an impossible date on an old order goes to a person", () => {
    const db = freshShop();
    expect(decideOn(db, "C005", "2026-13-01", "O1005", 4200).result).toBe("send_to_human");
  });

  // Hole: an empty date is NaN too, so none of C008's three recent refunds count.
  it.fails("R4: an empty date for a customer with 3 recent refunds goes to a person", () => {
    const db = freshShop();
    expect(decideOn(db, "C008", "", "O1011", 4600).result).toBe("send_to_human");
  });

  // Hole: a word for a date is NaN, so a 5-day-old account doesn't count as new.
  it.fails("R10: a garbage date for a brand-new account goes to a person", () => {
    const db = freshShop();
    expect(decideOn(db, "C024", "next tuesday", "O1037", 3200).result).toBe("send_to_human");
  });

  // Hole: a time of day adds half a day, so a calendar 30-day-old account counts as 30.5 days and isn't new.
  it.fails("R10: an account opened 30 days before a request stamped at noon UTC goes to a person", () => {
    const db = freshShop();
    db.prepare("INSERT INTO customers (id, name, email, joined_on, flagged) VALUES ('C901', 'Ada Fenwick', 'ada.fenwick@example.com', '2026-09-01', 0)").run();
    addOrder(db, "O5101", "C901", "2026-09-15");
    expect(decideOn(db, "C901", "2026-10-01T12:00:00Z", "O5101", 3000).result).toBe("send_to_human");
  });

  // Hole: same half day, so a refund made exactly 90 days earlier drops out of R4's count.
  it.fails("R4: a refund made 90 days before a request stamped at noon UTC still counts", () => {
    const db = freshShop();
    addOrder(db, "O5201", "C012", "2026-06-25");
    addOrder(db, "O5202", "C012", "2026-08-01");
    addOrder(db, "O5203", "C012", "2026-09-01");
    const insertRefund = db.prepare("INSERT INTO refunds (id, order_id, refunded_on, amount_cents, reason) VALUES (?, ?, ?, 1000, 'Damaged')");
    insertRefund.run("RF901", "O5201", "2026-07-03");
    insertRefund.run("RF902", "O5202", "2026-08-05");
    insertRefund.run("RF903", "O5203", "2026-09-05");
    expect(decideOn(db, "C012", "2026-10-01T12:00:00Z", "O1024", 4500).result).toBe("send_to_human");
  });

  it("R3: a time of day past midnight UTC pushes a 30-day-old order over the line", () => {
    const db = freshShop();
    expect(decideOn(db, "C006", "2026-10-01T00:00:00Z", "O1006", 3500).result).toBe("allow");
    expect(decideOn(db, "C006", "2026-10-01T00:00:01Z", "O1006", 3500)).toEqual({ result: "send_to_human", rules: ["R3"] });
  });

  it("R3: a request written with a US date or a time zone still sends a 31-day-old order to a person", () => {
    const db = freshShop();
    expect(decideOn(db, "C006", "10/02/2026", "O1006", 3500)).toEqual({ result: "send_to_human", rules: ["R3"] });
    expect(decideOn(db, "C006", "2026-10-02T23:59:59-08:00", "O1006", 3500)).toEqual({ result: "send_to_human", rules: ["R3"] });
  });
});

describe("join dates and refund dates after the request", () => {
  // Hole: joined 9 days after the request, so the day count is -9 and R10's 0-to-30 check misses it.
  it.fails("R10: an account opened after its request arrived goes to a person", () => {
    const db = freshShop();
    db.prepare("INSERT INTO customers (id, name, email, joined_on, flagged) VALUES ('C902', 'Bo Lindgren', 'bo.lindgren@example.com', '2026-10-11', 0)").run();
    addOrder(db, "O5301", "C902", "2026-09-30");
    expect(decideOn(db, "C902", "2026-10-02", "O5301", 3000).result).toBe("send_to_human");
  });

  // Four requests on four orders all arrive Oct 2. Each refund is dated by the day it's paid.
  async function fourRequests(paidAt: string) {
    const db = freshShop();
    for (const n of [1, 2, 3]) addOrder(db, `O540${n}`, "C012", "2026-09-20", 2000);
    const outcomes = [];
    for (const [n, orderId] of ["O5401", "O5402", "O5403", "O1024"].entries()) {
      addRequest(db, `LATE-${n}`, "C012", "2026-10-02");
      outcomes.push((await processRequest(db, `LATE-${n}`, async () => refundForm(orderId, 2000), paidAt)).outcome);
    }
    db.close();
    return outcomes;
  }

  it("R4: four refunds asked and paid the same day: the fourth goes to a person", async () => {
    expect(await fourRequests("2026-10-02T09:00:00Z")).toEqual(["paid", "paid", "paid", "waiting_for_human"]);
  });

  // Hole: paid the next morning, the three earlier refunds are dated after the request (-1 day) and R4 skips them.
  it.fails("R4: the same four requests worked through the next morning: the fourth still goes to a person", async () => {
    expect(await fourRequests("2026-10-03T09:00:00Z")).toEqual(["paid", "paid", "paid", "waiting_for_human"]);
  });
});
