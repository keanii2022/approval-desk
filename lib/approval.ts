import type { DatabaseSync } from "node:sqlite";
import { executeRefund, type Refusal } from "./executor.ts";
import { refundedCents, type RuleId } from "./gate.ts";
import { ensureLogbook, logHumanApproval, logHumanReject, logRefusal, readEntries } from "./logbook.ts";
import { dollars, parseDollars } from "./money.ts";
import { humanQueue, utcNow } from "./pipeline.ts";

// What the approval screen shows and does. The screen is a thin layer over this
// file: everything a person sees is worked out here, and every decision goes
// through the logbook's writers, which hold a person to R1 and R8 and require a
// note for a reject. Nothing here changes an order except by handing a logbook
// line number to the executor.

export type OrderChoice = {
  id: string;
  item: string;
  placedOn: string;
  paidCents: number;
  refundedCents: number;
  leftCents: number; // the most that can still be refunded on this order (R1)
};

export type WaitingCase = {
  gateEntryId: number;
  requestId: string;
  waitingSince: string;
  customer: { id: string; name: string };
  request: { subject: string; body: string; receivedOn: string };
  why: string[]; // the gate's reasons, in plain words
  agent: {
    status: "answered" | "ai_down";
    action: string | null; // refund, no_refund or unsure
    reason: string | null;
    policyLine: string | null;
    suggestedAmountCents: number | null;
  };
  orderFixed: boolean; // the form named a refund order, so that is the only order a person can approve
  orders: OrderChoice[]; // what the person can choose from: only the asking customer's own orders (R8)
  suggestedOrderId: string | null;
};

export type ApprovedNotPaid = {
  gateEntryId: number;
  approvalEntryId: number;
  requestId: string;
  customerName: string;
  orderId: string;
  amountCents: number;
  because: string | null; // why the executor refused, if it said (a code)
  becauseWords: string | null; // the same, in plain words
  retryable: boolean; // false when trying again can never work, for example R1 at payment
};

export type Decision =
  | { ok: false; message: string } // refused: nothing was written, nothing changed
  | { ok: true; outcome: "paid"; message: string; refundId: string }
  | { ok: true; outcome: "already_paid"; message: string } // asked to pay something that was already paid: nothing more was done
  | { ok: true; outcome: "rejected"; message: string }
  | { ok: true; outcome: "approved_not_paid"; message: string }; // the approval is on record but nothing was paid

const RULE_WORDS: Record<RuleId, string> = {
  R1: "It would refund more than was paid",
  R2: "The refund is over $100",
  R3: "The order is more than 30 days old",
  R4: "The customer has had 3 or more refunds in the last 90 days",
  R5: "The agent's form was garbled",
  R6: "The AI was unsure or unavailable",
  R8: "The order isn't the customer's own",
};

// Why the executor refused, in plain words. Only some refusals can ever be fixed by trying again.
const REFUSAL_WORDS: Record<Refusal, string> = {
  not_approved: "the approval isn't valid",
  nothing_to_pay: "there was nothing to pay",
  already_done: "this request was already paid",
  R1: "it would be more than is left on the order now",
  R7: "the logbook couldn't write it down",
  R8: "the order isn't the customer's own",
};
const RETRYABLE: Refusal[] = ["R7"];

export function ruleInWords(rule: RuleId): string {
  return RULE_WORDS[rule];
}

type OrderRow = { id: string; item: string; placed_on: string; amount_paid_cents: number };

function orderChoice(db: DatabaseSync, row: OrderRow): OrderChoice {
  const refunded = refundedCents(db, row.id);
  return {
    id: row.id,
    item: row.item,
    placedOn: row.placed_on,
    paidCents: row.amount_paid_cents,
    refundedCents: refunded,
    leftCents: Math.max(0, row.amount_paid_cents - refunded),
  };
}

// Everything waiting for a person, oldest first, with what they need to decide.
export function getWaitingCases(db: DatabaseSync): WaitingCase[] {
  return humanQueue(db).map((item) => {
    const request = db
      .prepare("SELECT customer_id, subject, body, received_on FROM inbox WHERE id = ?")
      .get(item.requestId) as { customer_id: string; subject: string; body: string; received_on: string };
    const customer = db.prepare("SELECT id, name FROM customers WHERE id = ?").get(request.customer_id) as {
      id: string;
      name: string;
    };

    const form =
      item.output.status === "answered" && typeof item.output.form === "object" && item.output.form !== null
        ? (item.output.form as { action?: unknown; orderId?: unknown; amountCents?: unknown; reason?: unknown; policyLine?: unknown })
        : null;
    const named = form && typeof form.orderId === "string" ? form.orderId : null;
    const orderFixed = form?.action === "refund" && named !== null;

    const own = db
      .prepare("SELECT id, item, placed_on, amount_paid_cents FROM orders WHERE customer_id = ? ORDER BY placed_on, id")
      .all(customer.id) as OrderRow[];
    const choices = (orderFixed ? own.filter((o) => o.id === named) : own).map((o) => orderChoice(db, o));

    const why = item.rules.map((rule) =>
      rule === "R6" ? (form?.action === "unsure" ? "The AI was unsure what to do" : "The AI was unavailable") : ruleInWords(rule),
    );

    return {
      gateEntryId: item.gateEntryId,
      requestId: item.requestId,
      waitingSince: item.waitingSince,
      customer,
      request: { subject: request.subject, body: request.body, receivedOn: request.received_on },
      why,
      agent: {
        status: item.output.status === "answered" ? "answered" : "ai_down",
        action: typeof form?.action === "string" ? form.action : null,
        reason: typeof form?.reason === "string" ? form.reason : null,
        policyLine: typeof form?.policyLine === "string" ? form.policyLine : null,
        suggestedAmountCents: Number.isSafeInteger(form?.amountCents) ? (form?.amountCents as number) : null,
      },
      orderFixed,
      orders: choices,
      suggestedOrderId: choices.some((o) => o.id === named) ? named : null,
    };
  });
}

// A person approves: the order they chose and the amount they typed (in dollars).
// The writer holds them to R1 and R8; then the executor pays. If the executor
// refuses after the approval is on record, that is said plainly and written down.
export function approveAndPay(
  db: DatabaseSync,
  gateEntryId: number,
  input: { orderId: string; amount: string },
  now: string = utcNow(),
): Decision {
  const amountCents = parseDollars(input.amount);
  if (amountCents === null) return { ok: false, message: "Enter an amount in dollars, like 150.00" };
  if (typeof input.orderId !== "string" || input.orderId.trim() === "") return { ok: false, message: "Pick an order" };

  let entryId: number;
  try {
    ({ entryId } = logHumanApproval(db, gateEntryId, { decision: "approve", orderId: input.orderId, amountCents }, now));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  return pay(db, gateEntryId, entryId, amountCents, now);
}

function pay(db: DatabaseSync, gateEntryId: number, approvalEntryId: number, amountCents: number, now: string): Decision {
  let paid;
  try {
    paid = executeRefund(db, approvalEntryId, now);
  } catch (error) {
    console.error("The executor threw while paying an approval", error); // e.g. a busy database: nothing was changed
    return { ok: true, outcome: "approved_not_paid", message: "Your approval is on record, but NOTHING was paid: something went wrong while paying." };
  }
  if (paid.result === "done") {
    return { ok: true, outcome: "paid", refundId: paid.refundId, message: `Approved and paid ${dollars(amountCents)} (refund ${paid.refundId}).` };
  }
  // Asked to pay something that was already paid: say so, and write nothing down.
  if (paid.because === "already_done") {
    return { ok: true, outcome: "already_paid", message: "That refund was already paid. Nothing more was done." };
  }
  return notPaid(db, gateEntryId, paid.because, now);
}

// The approval is on record but nothing was paid. The refusal is written down once
// per reason, so pressing "try again" can't fill the logbook with the same line.
function notPaid(db: DatabaseSync, gateEntryId: number, because: Refusal, now: string): Decision {
  try {
    const already = readEntries(db).some(
      (l) => l.kind === "refund_refused" && l.refersTo === gateEntryId && (l.details as { because?: string }).because === because,
    );
    if (!already) logRefusal(db, gateEntryId, because, now);
  } catch {
    // The approval is on record either way; the list below still shows it as unpaid.
  }
  return { ok: true, outcome: "approved_not_paid", message: `Your approval is on record, but NOTHING was paid: ${REFUSAL_WORDS[because]}.` };
}

// A person rejects. The note is required.
export function rejectRequest(db: DatabaseSync, gateEntryId: number, note: string, now: string = utcNow()): Decision {
  try {
    logHumanReject(db, gateEntryId, note, now);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, outcome: "rejected", message: "Rejected. Nothing was paid." };
}

// Approvals that are on record but were never paid, so they can't be missed.
export function approvedNotPaid(db: DatabaseSync): ApprovedNotPaid[] {
  ensureLogbook(db);
  const lines = readEntries(db);
  const paidRequests = new Set(lines.filter((l) => l.kind === "refund_done").map((l) => l.requestId));

  return lines
    .filter((l) => l.kind === "human_decision" && !paidRequests.has(l.requestId))
    .flatMap((l) => {
      const details = l.details as { decision?: string; orderId?: string; amountCents?: number };
      if (details.decision !== "approve" || l.refersTo === null) return [];
      const customer = db
        .prepare("SELECT c.name FROM inbox i JOIN customers c ON c.id = i.customer_id WHERE i.id = ?")
        .get(l.requestId) as { name: string } | undefined;
      const refusal = [...lines].reverse().find((r) => r.kind === "refund_refused" && r.refersTo === l.refersTo);
      const because = refusal ? (refusal.details as { because?: Refusal }).because ?? null : null;
      return [
        {
          gateEntryId: l.refersTo,
          approvalEntryId: l.id,
          requestId: l.requestId,
          customerName: customer?.name ?? "Unknown customer",
          orderId: String(details.orderId),
          amountCents: Number(details.amountCents),
          because,
          becauseWords: because ? (REFUSAL_WORDS[because] ?? because) : null,
          retryable: because === null || RETRYABLE.includes(because), // no reason on record: an error, which may pass
        },
      ];
    });
}

// Hands an approved-but-unpaid approval to the executor again. The executor pays
// each request at most once, so asking twice is safe.
export function retryPayment(db: DatabaseSync, approvalEntryId: number, now: string = utcNow()): Decision {
  const line = readEntries(db).find((l) => l.id === approvalEntryId && l.kind === "human_decision");
  const details = line?.details as { decision?: string; amountCents?: number } | undefined;
  if (!line || line.refersTo === null || details?.decision !== "approve") {
    return { ok: false, message: "That isn't an approval waiting to be paid" };
  }
  return pay(db, line.refersTo, line.id, Number(details.amountCents), now);
}
