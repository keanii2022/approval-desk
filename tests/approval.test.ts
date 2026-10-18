import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { refunds } from "../data/shop.ts";
import type { AskModel } from "../lib/agent.ts";
import { approvedNotPaid, approveAndPay, getWaitingCases, rejectRequest, retryPayment } from "../lib/approval.ts";
import { openDatabase } from "../lib/db.ts";
import { executeRefund } from "../lib/executor.ts";
import { logHumanApproval, readEntries } from "../lib/logbook.ts";
import { humanQueue, processRequest } from "../lib/pipeline.ts";
import { seed } from "../lib/seed.ts";

// The approval screen's tests use a stand-in agent: a form written here ahead of time.
// No AI calls. Each test gets its own fresh database. The screen itself is tested in
// the browser (e2e/); these tests cover what it shows and what a person is allowed to do.

const NOW = "2026-10-05T12:00:00Z";
const SEEDED_REFUNDS = refunds.length;

function freshDb(): DatabaseSync {
  const db = openDatabase(":memory:");
  seed(db);
  return db;
}

const standIn = (form: unknown): AskModel => async () => form;
const AI_FAILS: AskModel = async () => {
  throw new Error("connection refused");
};
const refundForm = (orderId: string, amountCents: number) => ({
  action: "refund",
  orderId,
  amountCents,
  reason: "Arrived damaged",
  policyLine: "P02",
});
const unsureForm = (orderId: string | null, amountCents: number | null) => ({
  action: "unsure",
  orderId,
  amountCents,
  reason: "Can't tell which order",
  policyLine: "P13",
});

// A request the gate has sent to a person; returns its gate line number.
async function waiting(db: DatabaseSync, requestId: string, ask: AskModel): Promise<number> {
  const result = await processRequest(db, requestId, ask, NOW);
  if (result.outcome !== "waiting_for_human") throw new Error(`Expected a waiting request, got ${result.outcome}`);
  return result.gateEntryId;
}

const refundRows = (db: DatabaseSync) => db.prepare("SELECT * FROM refunds ORDER BY id").all();
const kinds = (db: DatabaseSync, requestId: string) => readEntries(db, requestId).map((line) => line.kind);

describe("Approval screen: what the screen shows", () => {
  it("a $150.00 refund the agent suggested: the order is fixed, with what was paid and what is left (REQ-002)", async () => {
    const db = freshDb();
    await waiting(db, "REQ-002", standIn(refundForm("O1002", 15000)));
    const [c] = getWaitingCases(db);

    expect(c).toMatchObject({
      requestId: "REQ-002",
      customer: { id: "C002", name: "Theo Achterberg" },
      why: ["The refund is over $100"],
      agent: { status: "answered", action: "refund", reason: "Arrived damaged", policyLine: "P02", suggestedAmountCents: 15000 },
      orderFixed: true,
      suggestedOrderId: "O1002",
    });
    expect(c.request.body).toContain("walnut desk lamp");
    expect(c.orders).toEqual([
      { id: "O1002", item: "Walnut desk lamp", placedOn: "2026-09-22", paidCents: 15000, refundedCents: 0, leftCents: 15000 },
    ]);
  });

  it("R6: if the AI was down, the person picks from the asking customer's own orders only (REQ-018)", async () => {
    const db = freshDb();
    await waiting(db, "REQ-018", AI_FAILS);
    const [c] = getWaitingCases(db);

    expect(c.why).toEqual(["The AI was unavailable"]);
    expect(c.agent).toMatchObject({ status: "ai_down", action: null, reason: null, suggestedAmountCents: null });
    expect(c.orderFixed).toBe(false);
    expect(c.orders.map((o) => o.id)).toEqual(["O1030", "O1031"]); // Arjun's two orders, nobody else's
    expect(c.suggestedOrderId).toBeNull();
  });

  it("R6: if the agent was unsure, its hints are shown, but a hint at someone else's order is not offered (R8)", async () => {
    const db = freshDb();
    await waiting(db, "REQ-022", standIn(unsureForm("O1001", 2400))); // O1001 is Mara's; REQ-022 is Oren's
    const [c] = getWaitingCases(db);

    expect(c.why).toEqual(["The AI was unsure what to do"]);
    expect(c.agent).toMatchObject({ action: "unsure", reason: "Can't tell which order", suggestedAmountCents: 2400 });
    expect(c.orders.map((o) => o.id)).toEqual(["O1035"]); // Oren's only order
    expect(c.suggestedOrderId).toBeNull();
  });

  it("earlier refunds are counted in what is left on an order (R1)", async () => {
    const db = freshDb();
    const { id } = db.prepare("SELECT id FROM inbox WHERE customer_id = 'C008' LIMIT 1").get() as { id: string };
    await waiting(db, id, AI_FAILS);
    const [c] = getWaitingCases(db);
    const o1010 = c.orders.find((o) => o.id === "O1010")!;

    expect(o1010).toMatchObject({ paidCents: 1800, refundedCents: 900, leftCents: 900 });
    expect(c.orders.find((o) => o.id === "O1008")!.leftCents).toBe(0); // fully refunded already
  });
});

describe("Approval screen: a person approves", () => {
  it("approve: the executor pays, and the logbook has the gate line, the person's decision and the refund (REQ-002)", async () => {
    const db = freshDb();
    const gate = await waiting(db, "REQ-002", standIn(refundForm("O1002", 15000)));

    const result = approveAndPay(db, gate, { orderId: "O1002", amount: "150.00" }, NOW);
    expect(result).toEqual({ ok: true, outcome: "paid", refundId: "RF016", message: "Approved and paid $150.00 (refund RF016)." });
    expect(db.prepare("SELECT order_id, amount_cents FROM refunds WHERE id = 'RF016'").get()).toEqual({ order_id: "O1002", amount_cents: 15000 });
    expect(kinds(db, "REQ-002")).toEqual(["gate_decision", "human_decision", "refund_done"]);
    expect(humanQueue(db)).toEqual([]);
  });

  it("change the amount: a person can approve less than the agent suggested (REQ-002, $120.00)", async () => {
    const db = freshDb();
    const gate = await waiting(db, "REQ-002", standIn(refundForm("O1002", 15000)));

    expect(approveAndPay(db, gate, { orderId: "O1002", amount: "120" }, NOW)).toMatchObject({ ok: true, outcome: "paid" });
    expect(db.prepare("SELECT amount_cents FROM refunds WHERE id = 'RF016'").get()).toEqual({ amount_cents: 12000 });
  });

  it("R1: an amount over what is left on the order is refused, and nothing is written (REQ-002, $150.01)", async () => {
    const db = freshDb();
    const gate = await waiting(db, "REQ-002", standIn(refundForm("O1002", 15000)));
    const before = readEntries(db).length;

    const result = approveAndPay(db, gate, { orderId: "O1002", amount: "150.01" }, NOW);
    expect(result).toEqual({ ok: false, message: expect.stringContaining("more than what is left on this order") });
    expect(result.message).toContain("$150.00");
    expect(readEntries(db)).toHaveLength(before);
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS);
    expect(humanQueue(db)).toHaveLength(1); // still waiting
  });

  it("R1: earlier refunds count: $9.01 when $9.00 is left is refused, $9.00 is paid (the order a person picked after the AI was down)", async () => {
    const db = freshDb();
    const { id } = db.prepare("SELECT id FROM inbox WHERE customer_id = 'C008' LIMIT 1").get() as { id: string };
    const gate = await waiting(db, id, AI_FAILS);

    expect(approveAndPay(db, gate, { orderId: "O1010", amount: "9.01" }, NOW)).toMatchObject({ ok: false });
    expect(approveAndPay(db, gate, { orderId: "O1010", amount: "9.00" }, NOW)).toMatchObject({ ok: true, outcome: "paid" });
  });

  it("R8: a person can't pick someone else's order (REQ-002 is Theo's, O1001 is Mara's)", async () => {
    const db = freshDb();
    const gate = await waiting(db, "REQ-002", AI_FAILS);
    const before = readEntries(db).length;

    const result = approveAndPay(db, gate, { orderId: "O1001", amount: "5.00" }, NOW);
    expect(result).toEqual({ ok: false, message: expect.stringContaining("doesn't belong to the customer who asked") });
    expect(readEntries(db)).toHaveLength(before);
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS);
  });

  it("when the agent's form named an order, a person can't approve a different one, even their own (Saoirse's request, R4)", async () => {
    const db = freshDb();
    const { id } = db.prepare("SELECT id FROM inbox WHERE customer_id = 'C008' LIMIT 1").get() as { id: string };
    const gate = await waiting(db, id, standIn(refundForm("O1011", 4600))); // 3 refunds in 90 days: a person decides
    expect(getWaitingCases(db)[0].why).toEqual(["The customer has had 3 or more refunds in the last 90 days"]);

    expect(approveAndPay(db, gate, { orderId: "O1010", amount: "5.00" }, NOW)).toEqual({
      ok: false,
      message: "The person can only approve the order the gate checked",
    });
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS);
  });

  it("an amount that isn't a clear dollar amount is refused before anything is written", async () => {
    const db = freshDb();
    const gate = await waiting(db, "REQ-002", standIn(refundForm("O1002", 15000)));
    const before = readEntries(db).length;

    for (const bad of ["", "abc", "-5", "0", "12.345"]) {
      expect(approveAndPay(db, gate, { orderId: "O1002", amount: bad }, NOW), `"${bad}"`).toEqual({
        ok: false,
        message: "Enter an amount in dollars, like 150.00",
      });
    }
    expect(approveAndPay(db, gate, { orderId: "", amount: "10" }, NOW)).toEqual({ ok: false, message: "Pick an order" });
    expect(readEntries(db)).toHaveLength(before);
  });

  it("only one decision counts: a second approve or a reject after an approve is refused (REQ-002)", async () => {
    const db = freshDb();
    const gate = await waiting(db, "REQ-002", standIn(refundForm("O1002", 15000)));
    approveAndPay(db, gate, { orderId: "O1002", amount: "100" }, NOW);

    expect(approveAndPay(db, gate, { orderId: "O1002", amount: "50" }, NOW)).toMatchObject({ ok: false });
    expect(rejectRequest(db, gate, "changed my mind", NOW)).toMatchObject({ ok: false });
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS + 1);
  });
});

describe("Approval screen: a person rejects", () => {
  it("a reject without a note is refused, and the request stays in the queue (REQ-002)", async () => {
    const db = freshDb();
    const gate = await waiting(db, "REQ-002", standIn(refundForm("O1002", 15000)));
    const before = readEntries(db).length;

    for (const note of ["", "   ", "\n\t"]) {
      expect(rejectRequest(db, gate, note, NOW), JSON.stringify(note)).toEqual({ ok: false, message: "A note is required to reject a refund" });
    }
    expect(readEntries(db)).toHaveLength(before);
    expect(humanQueue(db)).toHaveLength(1);
  });

  it("a reject with a note: nothing is paid, the request leaves the queue, and the note is in the logbook (REQ-002)", async () => {
    const db = freshDb();
    const gate = await waiting(db, "REQ-002", standIn(refundForm("O1002", 15000)));

    expect(rejectRequest(db, gate, "  The lamp was used for a month  ", NOW)).toEqual({
      ok: true,
      outcome: "rejected",
      message: "Rejected. Nothing was paid.",
    });
    expect(humanQueue(db)).toEqual([]);
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS);
    const line = readEntries(db, "REQ-002")[1];
    expect(line).toMatchObject({ kind: "human_decision", refersTo: gate, details: { decision: "reject", note: "The lamp was used for a month" } });
  });

  it("the executor never pays a reject, even when handed its line number (REQ-002)", async () => {
    const db = freshDb();
    const gate = await waiting(db, "REQ-002", standIn(refundForm("O1002", 15000)));
    rejectRequest(db, gate, "No", NOW);
    const rejectLine = readEntries(db, "REQ-002")[1].id;

    expect(executeRefund(db, rejectLine, NOW)).toEqual({ result: "refused", because: "not_approved" });
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS);
  });

  it("only requests the gate sent to a person can be rejected (REQ-012 was blocked)", async () => {
    const db = freshDb();
    const result = await processRequest(db, "REQ-012", standIn(refundForm("O1024", 6000)), NOW);
    expect(result.outcome).toBe("blocked");
    const gate = (result as { gateEntryId: number }).gateEntryId;

    expect(rejectRequest(db, gate, "No", NOW)).toMatchObject({ ok: false });
    expect(() => logHumanApproval(db, gate, { decision: "approve", orderId: "O1024", amountCents: 100 }, NOW)).toThrow();
  });
});

describe("Approval screen: an approval the executor then refuses is never lost", () => {
  const NO_PAYMENTS = "CREATE TRIGGER test_no_payment BEFORE INSERT ON logbook WHEN NEW.kind = 'refund_done' BEGIN SELECT RAISE(ABORT, 'no payments'); END";

  it("R7: the approval is on record, nothing is paid, it is listed as unpaid, and paying again works once the logbook can (REQ-002)", async () => {
    const db = freshDb();
    const gate = await waiting(db, "REQ-002", standIn(refundForm("O1002", 15000)));
    db.exec(NO_PAYMENTS);

    const result = approveAndPay(db, gate, { orderId: "O1002", amount: "150" }, NOW);
    expect(result).toEqual({ ok: true, outcome: "approved_not_paid", message: expect.stringContaining("NOTHING was paid") });
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS);
    expect(kinds(db, "REQ-002")).toEqual(["gate_decision", "human_decision", "refund_refused"]);
    expect(approvedNotPaid(db)).toEqual([
      { gateEntryId: gate, approvalEntryId: expect.any(Number), requestId: "REQ-002", customerName: "Theo Achterberg", orderId: "O1002", amountCents: 15000, because: "R7", becauseWords: "the logbook couldn't write it down", retryable: true },
    ]);

    db.exec("DROP TRIGGER test_no_payment");
    const again = retryPayment(db, approvedNotPaid(db)[0].approvalEntryId, NOW);
    expect(again).toMatchObject({ ok: true, outcome: "paid", refundId: "RF016" });
    expect(approvedNotPaid(db)).toEqual([]);
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS + 1);
  });

  it("paying again can't pay twice, and says so without writing anything down (REQ-002)", async () => {
    const db = freshDb();
    const gate = await waiting(db, "REQ-002", standIn(refundForm("O1002", 15000)));
    approveAndPay(db, gate, { orderId: "O1002", amount: "150" }, NOW);
    const approvalLine = readEntries(db, "REQ-002")[1].id;
    const before = readEntries(db).length;

    expect(retryPayment(db, approvalLine, NOW)).toEqual({ ok: true, outcome: "already_paid", message: "That refund was already paid. Nothing more was done." });
    expect(readEntries(db)).toHaveLength(before);
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS + 1);
  });

  it("R1 at payment: if another refund used up the order after the approval, it can never be paid, so it can't be retried, and the refusal is written once (REQ-002)", async () => {
    const db = freshDb();
    const gate = await waiting(db, "REQ-002", standIn(refundForm("O1002", 15000)));
    const { entryId } = logHumanApproval(db, gate, { decision: "approve", orderId: "O1002", amountCents: 15000 }, NOW);
    db.prepare("INSERT INTO refunds (id, order_id, refunded_on, amount_cents, reason) VALUES ('RF900', 'O1002', '2026-10-01', 5000, 'test')").run();

    expect(retryPayment(db, entryId, NOW)).toMatchObject({ ok: true, outcome: "approved_not_paid", message: expect.stringContaining("more than is left") });
    expect(retryPayment(db, entryId, NOW)).toMatchObject({ outcome: "approved_not_paid" });
    expect(approvedNotPaid(db)).toMatchObject([{ because: "R1", becauseWords: "it would be more than is left on the order now", retryable: false }]);
    expect(kinds(db, "REQ-002").filter((k) => k === "refund_refused")).toHaveLength(1);
  });

  it("an approval with no reason on record (an error while paying) can be retried", async () => {
    const db = freshDb();
    const gate = await waiting(db, "REQ-002", standIn(refundForm("O1002", 15000)));
    logHumanApproval(db, gate, { decision: "approve", orderId: "O1002", amountCents: 15000 }, NOW);

    expect(approvedNotPaid(db)).toMatchObject([{ because: null, becauseWords: null, retryable: true }]);
  });

  it("a line that isn't an approval can't be retried", async () => {
    const db = freshDb();
    const gate = await waiting(db, "REQ-002", standIn(refundForm("O1002", 15000)));
    expect(retryPayment(db, gate, NOW)).toEqual({ ok: false, message: "That isn't an approval waiting to be paid" });
    expect(retryPayment(db, 999, NOW)).toMatchObject({ ok: false });
  });
});
