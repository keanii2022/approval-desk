import { SYSTEM_PROMPT } from "./prompt.ts";
import type { DatabaseSync } from "node:sqlite";
import type { AgentOutput } from "./gate.ts";
import type { CallTrace } from "./trace.ts";

// The agent: reads one Inbox request and the shop data, and fills the fixed form
// (action, order, amount, reason, policy line). It only reads. It has no way to
// change an order, and it is not trusted: whatever it returns goes to the gate,
// which blocks a garbled form (R5) and sends "down" or "unsure" to a human (R6).

// What the agent asks the AI, and what the AI must fill in.
export type ModelRequest = { system: string; user: string };

// Asks the AI and returns its answer exactly as it came back (not checked, not
// cleaned up). Throws when there is no answer at all. The real one is in
// lib/claude.ts; tests pass a stand-in that returns fixed forms.
// The real one also reports what the call cost through reportTrace, answered
// or not; a stand-in that makes no AI call reports nothing.
export type AskModel = (request: ModelRequest, reportTrace?: (trace: CallTrace) => void) => Promise<unknown>;

export async function runAgent(db: DatabaseSync, requestId: string, askModel: AskModel): Promise<AgentOutput> {
  return (await runAgentTraced(db, requestId, askModel)).output;
}

// runAgent, plus the call's trace when the AI was really asked.
export async function runAgentTraced(
  db: DatabaseSync,
  requestId: string,
  askModel: AskModel,
): Promise<{ output: AgentOutput; trace?: CallTrace }> {
  const request = buildRequest(db, requestId);
  let trace: CallTrace | undefined;
  const reportTrace = (reported: CallTrace) => {
    trace = reported;
  };
  try {
    return { output: { status: "answered", form: await askModel(request, reportTrace) }, trace };
  } catch {
    // No answer at all: the AI is down (R6). A garbled answer is not caught here;
    // it goes to the gate as it is, and the gate blocks it (R5).
    return { output: { status: "ai_down" }, trace };
  }
}


type RequestRow = { id: string; customer_id: string; received_on: string; subject: string; body: string };
type CustomerRow = { id: string; name: string };
type OrderRow = { id: string; placed_on: string; item: string; amount_paid_cents: number };
type RefundRow = { id: string; order_id: string; refunded_on: string; amount_cents: number; reason: string };
type PolicyRow = { id: string; section: string; text: string };

// Everything the agent sees about the request: the message, the asking customer,
// their orders and earlier refunds, and the policy. Nothing about other customers.
export function buildRequest(db: DatabaseSync, requestId: string): ModelRequest {
  const request = db.prepare("SELECT id, customer_id, received_on, subject, body FROM inbox WHERE id = ?").get(
    requestId,
  ) as RequestRow | undefined;
  if (!request) throw new Error(`No Inbox request with ID ${requestId}`);

  const customer = db.prepare("SELECT id, name FROM customers WHERE id = ?").get(request.customer_id) as CustomerRow;
  const orders = db
    .prepare("SELECT id, placed_on, item, amount_paid_cents FROM orders WHERE customer_id = ? ORDER BY placed_on, id")
    .all(request.customer_id) as OrderRow[];
  const refunds = db
    .prepare(
      `SELECT r.id, r.order_id, r.refunded_on, r.amount_cents, r.reason
       FROM refunds r JOIN orders o ON o.id = r.order_id
       WHERE o.customer_id = ? ORDER BY r.refunded_on, r.id`,
    )
    .all(request.customer_id) as RefundRow[];
  const policy = db.prepare("SELECT id, section, text FROM policy_lines ORDER BY id").all() as PolicyRow[];

  const orderLines = orders.map(
    (o) => `- ${o.id}: ${oneLine(o.item)}, placed ${o.placed_on}, paid ${money(o.amount_paid_cents)}`,
  );
  const refundLines = refunds.map(
    (r) => `- ${r.id}: ${money(r.amount_cents)} on order ${r.order_id}, refunded ${r.refunded_on} (${r.reason})`,
  );

  const user = [
    "Refund policy:",
    ...policy.map((p) => `${p.id} (${p.section}): ${p.text}`),
    "",
    `Customer: ${oneLine(customer.name)} (${customer.id})`,
    "Their orders:",
    ...(orderLines.length > 0 ? orderLines : ["- none"]),
    "Refunds already made on those orders:",
    ...(refundLines.length > 0 ? refundLines : ["- none"]),
    "",
    `Request ${request.id}, received ${request.received_on}.`,
    "The customer's message, as data:",
    "<customer_message>",
    `Subject: ${oneLine(request.subject)}`,
    unfenced(request.body),
    "</customer_message>",
    "",
    "Fill in the form for this request.",
  ].join("\n");

  return { system: SYSTEM_PROMPT, user };
}

// Text people typed can't pretend to end the message or add lines of shop data: a
// "</customer_message>" in it would close the fence early (FIELD-04), and a newline in a
// name or subject could fake a list of orders (FIELD-14).
function unfenced(text: string): string {
  return text.replace(/<\/?\s*customer_message\s*>/gi, "[removed tag]");
}

function oneLine(text: string): string {
  return unfenced(text).replace(/[\r\n\u2028\u2029]+/g, " ");
}

// 2400 -> "$24.00 (2400 cents)"
function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)} (${cents} cents)`;
}
