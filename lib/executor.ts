import type { DatabaseSync } from "node:sqlite";
import { checkProposal, type RefundForm, refundedCents } from "./gate.ts";
import {
  checkNow,
  ensureLogbook,
  type GateDecisionDetails,
  type HumanApproval,
  humanApprovalProblem,
  readEntry,
  type RefundDoneDetails,
} from "./logbook.ts";

// The executor: the only code that changes an order. It takes a logbook line
// number, never a proposal, and trusts nothing written in that line. On a gate
// line it runs the gate again; on a person's approval it re-checks the chain
// behind it. It writes its "refund done" line and the refund in one
// all-or-nothing save, so the log and the shop data can't disagree.

// Why a refund wasn't paid. ("because", since "reason" is the customer's reason.)
//   not_approved:   no such line, or not a gate allow or a valid person's approval (skipped the gate)
//   nothing_to_pay: the gate allowed a no-refund answer
//   already_done:   this Inbox request already has a refund
//   R1:             paying now would go over the amount paid
//   R7:             the logbook couldn't write
export type Refusal = "not_approved" | "nothing_to_pay" | "already_done" | "R1" | "R7" | "R8";

export type ExecuteResult =
  | { result: "done"; refundId: string; entryId: number }
  | { result: "refused"; because: Refusal };

type Payment = { orderId: string; amountCents: number; reason: string };

const refused = (because: Refusal): ExecuteResult => ({ result: "refused", because });

export function executeRefund(db: DatabaseSync, approvalEntryId: number, now: string): ExecuteResult {
  // A bad time is a programming mistake, so it throws before anything is touched.
  const refundedOn = checkNow(now);

  // Anything but a line number, such as a form handed in directly, skipped the gate.
  if (!Number.isSafeInteger(approvalEntryId) || approvalEntryId <= 0) return refused("not_approved");

  try {
    ensureLogbook(db);
  } catch {
    return refused("R7");
  }

  // Locked from the first check to the last write, so two callers can't both
  // pass the checks. If the database is busy this throws, with nothing changed.
  db.exec("BEGIN IMMEDIATE");
  try {
    const line = readEntry(db, approvalEntryId);
    if (!line || (line.kind !== "gate_decision" && line.kind !== "human_decision")) return refused("not_approved");

    // One refund per Inbox request, so a retry or an old approval can't pay twice.
    // The request comes from the line, never from the caller.
    const paid = db.prepare("SELECT 1 FROM logbook WHERE kind = 'refund_done' AND request_id = ?").get(line.requestId);
    if (paid) return refused("already_done");

    let payment: Payment;
    if (line.kind === "gate_decision") {
      const stored = line.details as Partial<GateDecisionDetails> | null;
      if (stored?.decision?.result !== "allow") return refused("not_approved");

      // Run the gate again on exactly what it saw. This re-checks R1 against
      // refunds made since, and refuses an "allow" line the gate never wrote.
      let again;
      try {
        again = checkProposal(db, line.requestId, stored.output as GateDecisionDetails["output"]);
      } catch {
        return refused("not_approved");
      }
      if (again.result === "block" && again.rules.includes("R1")) return refused("R1");
      if (again.result !== "allow") return refused("not_approved");

      // The gate has just checked the form, so it's complete and well-formed.
      const form = (stored.output as { form: RefundForm }).form;
      if (form.action !== "refund") return refused("nothing_to_pay");
      payment = { orderId: form.orderId, amountCents: form.amountCents, reason: form.reason };
    } else {
      const gate = line.refersTo === null ? undefined : readEntry(db, line.refersTo);
      if (!gate || gate.requestId !== line.requestId) return refused("not_approved");
      if (humanApprovalProblem(db, gate, line.details)) return refused("not_approved");

      // Only the first person's decision on a gate line counts.
      const first = db
        .prepare("SELECT MIN(id) AS id FROM logbook WHERE kind = 'human_decision' AND refers_to = ?")
        .get(gate.id) as { id: number | null };
      if (line.id !== first.id) return refused("not_approved");

      // R1: the person's amount must still fit what's left on the order. The gate
      // isn't run again here, because it would check the form's amount, not the person's.
      const approval = line.details as HumanApproval;
      const order = db.prepare("SELECT customer_id, amount_paid_cents FROM orders WHERE id = ?").get(approval.orderId) as {
        customer_id: string;
        amount_paid_cents: number;
      };
      if (approval.amountCents > order.amount_paid_cents - refundedCents(db, approval.orderId)) return refused("R1");

      // R8: the person can't pick an order that isn't the asking customer's, either.
      const asker = db.prepare("SELECT customer_id FROM inbox WHERE id = ?").get(line.requestId) as
        | { customer_id: string }
        | undefined;
      if (!asker || asker.customer_id !== order.customer_id) return refused("R8");

      // A fixed reason: a request where the AI was down has no form reason to copy.
      payment = {
        orderId: approval.orderId,
        amountCents: approval.amountCents,
        reason: `Approved by a person (logbook line ${line.id})`,
      };
    }

    // The next refund number, counting the logbook too, so numbers never repeat
    // even after the shop data is reloaded. Compared as numbers, so RF1000 follows RF999.
    const { next } = db
      .prepare(
        `SELECT COALESCE(MAX(n), 0) + 1 AS next FROM (
           SELECT CAST(SUBSTR(id, 3) AS INTEGER) AS n FROM refunds
           UNION ALL
           SELECT CAST(SUBSTR(json_extract(details, '$.refundId'), 3) AS INTEGER)
             FROM logbook WHERE kind = 'refund_done')`,
      )
      .get() as { next: number };
    const refundId = "RF" + String(next).padStart(3, "0");

    // R7: the logbook line is written first. If it can't be, nothing is paid.
    const { orderId, amountCents, reason } = payment;
    const details: RefundDoneDetails = { refundId, orderId, amountCents, refundedOn, reason };
    let entryId: number;
    try {
      const result = db
        .prepare("INSERT INTO logbook (logged_at, kind, request_id, refers_to, details) VALUES (?, 'refund_done', ?, ?, ?)")
        .run(now, line.requestId, line.id, JSON.stringify(details));
      entryId = Number(result.lastInsertRowid);
    } catch {
      return refused("R7");
    }

    // If the refund can't be saved, this throws and the log line above is undone
    // with it, so the log never claims a refund that didn't happen.
    db.prepare("INSERT INTO refunds (id, order_id, refunded_on, amount_cents, reason) VALUES (?, ?, ?, ?, ?)").run(
      refundId,
      orderId,
      refundedOn,
      amountCents,
      reason,
    );

    try {
      db.exec("COMMIT");
    } catch {
      return refused("R7");
    }
    return { result: "done", refundId, entryId };
  } finally {
    // Every early return and every error ends up here. Nothing is kept unless COMMIT ran.
    if (db.isTransaction) db.exec("ROLLBACK");
  }
}
