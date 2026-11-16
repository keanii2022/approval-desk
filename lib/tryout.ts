import type { DatabaseSync } from "node:sqlite";
import type { AskModel } from "./agent.ts";
import type { AgentOutput, GateDecision } from "./gate.ts";
import { type GateDecisionDetails, readEntries } from "./logbook.ts";
import { type PipelineResult, processRequest, utcNow } from "./pipeline.ts";

// "Try it yourself": a person writes a request as one of the shop's customers,
// and it runs the same path as any Inbox request (agent -> gate -> executor or
// human queue), written to the same logbook. Tried requests get TRY- IDs so they
// never mix with the seeded REQ- ones the practice cases use.

import { MESSAGE_MAX, NAME_MAX, NEW_CUSTOMER, type ReceiptCustomer, SUBJECT_MAX } from "./try-fields.ts";

export { MESSAGE_MAX, NAME_MAX, NEW_CUSTOMER, SUBJECT_MAX };

export type TryInput = { customerId: string; subject: string; message: string; newName?: string };

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// Every customer with what they bought, for the "receipt" shown on the try page.
export function customerReceipts(db: DatabaseSync): ReceiptCustomer[] {
  const customers = db.prepare("SELECT id, name FROM customers ORDER BY name").all() as { id: string; name: string }[];
  const orders = db
    .prepare(
      `SELECT o.id, o.customer_id, o.item, o.placed_on, o.amount_paid_cents AS paid,
              COALESCE((SELECT SUM(amount_cents) FROM refunds r WHERE r.order_id = o.id), 0) AS refunded
       FROM orders o ORDER BY o.placed_on, o.id`,
    )
    .all() as { id: string; customer_id: string; item: string; placed_on: string; paid: number; refunded: number }[];
  return customers.map((c) => ({
    ...c,
    orders: orders
      .filter((o) => o.customer_id === c.id)
      .map((o) => ({
        id: o.id,
        item: o.item,
        placedOn: o.placed_on,
        paid: dollars(o.paid),
        refunded: dollars(o.refunded),
        left: dollars(o.paid - o.refunded),
        paidCents: o.paid,
        leftCents: o.paid - o.refunded,
      })),
  }));
}

export type Tried = {
  requestId: string;
  customerName: string;
  subject: string;
  message: string;
  agent: AgentOutput | null; // null only if the gate's line is missing (the logbook couldn't write)
  gate: GateDecision | null;
  outcome: string; // what happened in the end, in plain words
};

// Checks what the person typed. Returns the problem in plain words, or null.
export function tryInputProblem(db: DatabaseSync, input: TryInput): string | null {
  if (input.customerId === NEW_CUSTOMER) {
    const name = (input.newName ?? "").trim();
    if (name === "") return "Type a name for the new customer";
    if (name.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters`;
  } else if (!db.prepare("SELECT 1 FROM customers WHERE id = ?").get(input.customerId)) return "Pick a customer";
  if (input.message.trim() === "") return "Write a message";
  if (input.subject.length > SUBJECT_MAX) return `Keep the subject under ${SUBJECT_MAX} characters`;
  if (input.message.length > MESSAGE_MAX) return `Keep the message under ${MESSAGE_MAX} characters`;
  return null;
}

// Adds the request to the Inbox and runs it. Throws if the input is bad; check it first.
export async function tryRequest(
  db: DatabaseSync,
  input: TryInput,
  askModel: AskModel,
): Promise<{ requestId: string; result: PipelineResult }> {
  const problem = tryInputProblem(db, input);
  if (problem) throw new Error(problem);

  const customerId = input.customerId === NEW_CUSTOMER ? addNewCustomer(db, (input.newName ?? "").trim()) : input.customerId;
  const requestId = nextTryId(db);
  db.prepare("INSERT INTO inbox (id, customer_id, received_on, subject, body) VALUES (?, ?, ?, ?, ?)").run(
    requestId,
    customerId,
    shopToday(db),
    input.subject.trim() || "(no subject)",
    input.message.trim(),
  );
  return { requestId, result: await processRequest(db, requestId, askModel) };
}

// The invented shop lives in early October 2026. Dating a try with the real date
// would make every order "older than 30 days" (R3), so tries are dated on the
// shop's own calendar: the day of its latest seeded request.
function shopToday(db: DatabaseSync): string {
  const row = db.prepare("SELECT MAX(received_on) AS day FROM inbox WHERE id LIKE 'REQ-%'").get() as { day: string | null };
  return row.day ?? utcNow().slice(0, 10);
}

// New customers get N- IDs so they never clash with the seeded C- ones.
function addNewCustomer(db: DatabaseSync, name: string): string {
  const row = db.prepare("SELECT MAX(CAST(SUBSTR(id, 3) AS INTEGER)) AS n FROM customers WHERE id LIKE 'N-%'").get() as {
    n: number | null;
  };
  const id = `N-${String((row.n ?? 0) + 1).padStart(3, "0")}`;
  db.prepare("INSERT INTO customers (id, name, email) VALUES (?, ?, ?)").run(id, name, `${id.toLowerCase()}@example.com`);
  return id;
}

function nextTryId(db: DatabaseSync): string {
  const row = db.prepare("SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) AS n FROM inbox WHERE id LIKE 'TRY-%'").get() as {
    n: number | null;
  };
  return `TRY-${String((row.n ?? 0) + 1).padStart(3, "0")}`;
}

// The tried requests, newest first, each with what the agent said, what the gate
// decided, and how it ended, read back from the logbook.
export function recentTries(db: DatabaseSync, limit = 20): Tried[] {
  const rows = db
    .prepare(
      `SELECT i.id, i.subject, i.body, c.name FROM inbox i JOIN customers c ON c.id = i.customer_id
       WHERE i.id LIKE 'TRY-%' ORDER BY CAST(SUBSTR(i.id, 5) AS INTEGER) DESC LIMIT ?`,
    )
    .all(limit) as { id: string; subject: string; body: string; name: string }[];

  return rows.map((row) => {
    const entries = readEntries(db, row.id);
    const gateLine = entries.find((e) => e.kind === "gate_decision");
    const details = gateLine?.details as GateDecisionDetails | undefined;
    const kinds = new Set(entries.map((e) => e.kind));
    return {
      requestId: row.id,
      customerName: row.name,
      subject: row.subject,
      message: row.body,
      agent: details?.output ?? null,
      gate: details?.decision ?? null,
      outcome: outcomeInWords(details?.decision ?? null, kinds, entries),
    };
  });
}

function outcomeInWords(gate: GateDecision | null, kinds: Set<string>, entries: { kind: string; details: unknown }[]): string {
  if (!gate) return "Nothing happened: the logbook couldn't write the gate's decision.";
  if (kinds.has("refund_done")) return "Refund paid.";
  if (kinds.has("refund_refused")) return "Not paid: the payment step refused it.";
  if (kinds.has("human_decision")) {
    const human = entries.find((e) => e.kind === "human_decision")?.details as { decision?: string } | undefined;
    return human?.decision === "reject" ? "A person rejected it." : "A person approved it.";
  }
  if (gate.result === "block") return "Blocked. Nothing was paid.";
  if (gate.result === "send_to_human") return "Waiting for a person on the Approvals screen.";
  return "Allowed, with nothing to pay.";
}
