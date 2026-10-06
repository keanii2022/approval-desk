import type { DatabaseSync } from "node:sqlite";

// The gate: plain code, no AI. It checks the agent's answer to one Inbox request
// against the hard rules in docs/RULES.md and returns one result, naming the
// rules behind it. It checks R1 to R6; R7 belongs to the logbook and executor.

export type RuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";

export type GateDecision = {
  result: "allow" | "send_to_human" | "block";
  rules: RuleId[];
};

// The fixed form the agent fills. Money is in cents, like the shop data.
//   refund:    an order that exists and an amount are required.
//   no_refund: the message doesn't ask for a refund (P07), so there's no amount.
//   unsure:    the agent can't decide (R6). Order and amount are optional hints for the human.
export type RefundForm =
  | { action: "refund"; orderId: string; amountCents: number; reason: string; policyLine: string }
  | { action: "no_refund"; orderId: string | null; amountCents: null; reason: string; policyLine: string }
  | { action: "unsure"; orderId: string | null; amountCents: number | null; reason: string; policyLine: string };

// What the agent hands the gate: the form exactly as it came back, which isn't
// trusted until the gate has checked it, or word that the AI gave no answer.
export type AgentOutput = { status: "answered"; form: unknown } | { status: "ai_down" };

const FORM_FIELDS = ["action", "amountCents", "orderId", "policyLine", "reason"]; // sorted

const R2_HUMAN_ABOVE_CENTS = 10_000; // over $100.00 (Q1)
const R3_HUMAN_ABOVE_DAYS = 30; // older than 30 days (Q2)
const R4_HUMAN_AT_REFUNDS = 3; // 3+ earlier refunds,
const R4_WINDOW_DAYS = 90; // made 90 days or fewer before the request (Q3)

type Request = { customer_id: string; received_on: string };
type Order = { placed_on: string; amount_paid_cents: number };

// When several rules apply, the strictest result wins (block, then send to
// human, then allow), and every rule behind that result is named (Q4).
export function checkProposal(db: DatabaseSync, requestId: string, output: AgentOutput): GateDecision {
  const request = db.prepare("SELECT customer_id, received_on FROM inbox WHERE id = ?").get(requestId) as
    | Request
    | undefined;
  if (!request) throw new Error(`No Inbox request with ID ${requestId}`);

  // R6: anything other than an answer counts as the AI being down.
  if (output.status !== "answered") return { result: "send_to_human", rules: ["R6"] };

  // R5: an incomplete or malformed form is blocked before anything else is checked.
  const form = readForm(db, output.form);
  if (!form) return { result: "block", rules: ["R5"] };

  // R6 (Q5): the agent said it's unsure. Nothing on its form is carried out, so a human decides.
  if (form.action === "unsure") return { result: "send_to_human", rules: ["R6"] };

  // Nothing is refunded, so there's nothing to check.
  if (form.action === "no_refund") return { result: "allow", rules: [] };

  // R5: a refund on an order that doesn't exist can't be checked or carried out.
  const order = db.prepare("SELECT placed_on, amount_paid_cents FROM orders WHERE id = ?").get(form.orderId) as
    | Order
    | undefined;
  if (!order) return { result: "block", rules: ["R5"] };

  const blocking: RuleId[] = [];
  const needsHuman: RuleId[] = [];
  if (form.amountCents > order.amount_paid_cents - refundedCents(db, form.orderId)) blocking.push("R1");
  if (form.amountCents > R2_HUMAN_ABOVE_CENTS) needsHuman.push("R2");
  if (daysBetween(order.placed_on, request.received_on) > R3_HUMAN_ABOVE_DAYS) needsHuman.push("R3");
  if (recentRefunds(db, request) >= R4_HUMAN_AT_REFUNDS) needsHuman.push("R4");

  if (blocking.length > 0) return { result: "block", rules: blocking };
  if (needsHuman.length > 0) return { result: "send_to_human", rules: needsHuman };
  return { result: "allow", rules: [] };
}

// Returns the form if it's complete and well-formed (R5), or null if it isn't.
function readForm(db: DatabaseSync, raw: unknown): RefundForm | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;

  // Every field is there, and nothing extra.
  if (Object.keys(raw).sort().join() !== FORM_FIELDS.join()) return null;

  const { action, orderId, amountCents, reason, policyLine } = raw as Record<string, unknown>;
  const hasOrder = typeof orderId === "string" && orderId.trim() !== "";
  const hasAmount = Number.isSafeInteger(amountCents) && (amountCents as number) > 0;

  if (orderId !== null && !hasOrder) return null;
  if (amountCents !== null && !hasAmount) return null;
  if (typeof reason !== "string" || reason.trim() === "") return null;
  if (typeof policyLine !== "string" || !db.prepare("SELECT 1 FROM policy_lines WHERE id = ?").get(policyLine)) {
    return null;
  }

  const form = { action, orderId, amountCents, reason, policyLine } as RefundForm;
  if (action === "refund" && hasOrder && hasAmount) return form;
  if (action === "no_refund" && amountCents === null) return form;
  if (action === "unsure") return form;
  return null;
}

// R1: every refund on the order so far, whenever it was made.
function refundedCents(db: DatabaseSync, orderId: string): number {
  const row = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM refunds WHERE order_id = ?").get(
    orderId,
  ) as { total: number };
  return row.total;
}

// R4 (Q3): the asking customer's refunds, on any of their orders, made 0 to 90
// days before the request arrived. The refund being asked for isn't one of them.
function recentRefunds(db: DatabaseSync, request: Request): number {
  const rows = db
    .prepare("SELECT r.refunded_on FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.customer_id = ?")
    .all(request.customer_id) as { refunded_on: string }[];
  return rows.filter((row) => {
    const days = daysBetween(row.refunded_on, request.received_on);
    return days >= 0 && days <= R4_WINDOW_DAYS;
  }).length;
}

// Whole days from one YYYY-MM-DD date to another.
function daysBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000;
}
