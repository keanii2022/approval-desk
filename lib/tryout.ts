import type { DatabaseSync } from "node:sqlite";
import type { AskModel } from "./agent.ts";
import type { AgentOutput, GateDecision } from "./gate.ts";
import { type GateDecisionDetails, readEntries } from "./logbook.ts";
import { type PipelineResult, processRequest, utcNow } from "./pipeline.ts";
import { countTry, ensureVisitorTable, recordTry, spendingProblem, type TryLimits } from "./visitor.ts";

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

// counts is where the site-wide try counts live (lib/visitor-db.ts openCounts); without it they're kept in db.
export type Visit = { visitorId: string; now?: string; limits?: TryLimits; counts?: DatabaseSync; network?: string | null };

// Adds the request to the Inbox, owned by the visitor, and runs it. Throws if the
// input is bad or a spending limit is reached; check both first. Both checks come
// before anything is written and before the agent is asked.
export async function tryRequest(
  db: DatabaseSync,
  input: TryInput,
  askModel: AskModel,
  visit: Visit,
): Promise<{ requestId: string; result: PipelineResult }> {
  const problem = tryInputProblem(db, input);
  if (problem) throw new Error(problem);
  const now = visit.now ?? utcNow();
  const counts = visit.counts ?? db;
  const overLimit = spendingProblem(counts, visit.visitorId, now, visit.limits, visit.network ?? null);
  if (overLimit) throw new Error(overLimit);

  const customerId = input.customerId === NEW_CUSTOMER ? addNewCustomer(db, (input.newName ?? "").trim()) : input.customerId;
  const requestId = nextTryId(db);
  db.prepare("INSERT INTO inbox (id, customer_id, received_on, subject, body) VALUES (?, ?, ?, ?, ?)").run(
    requestId,
    customerId,
    shopToday(db),
    input.subject.trim() || "(no subject)",
    input.message.trim(),
  );
  recordTry(db, requestId, visit.visitorId, now);
  countTry(counts, visit.visitorId, now, visit.network ?? null);
  return { requestId, result: await processRequest(db, requestId, askModel, now) };
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
  // Joined today, so R10 sees a brand-new account (it used to take the 2025 default).
  db.prepare("INSERT INTO customers (id, name, email, joined_on) VALUES (?, ?, ?, ?)").run(id, name, `${id.toLowerCase()}@example.com`, shopToday(db));
  return id;
}

function nextTryId(db: DatabaseSync): string {
  const row = db.prepare("SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) AS n FROM inbox WHERE id LIKE 'TRY-%'").get() as {
    n: number | null;
  };
  return `TRY-${String((row.n ?? 0) + 1).padStart(3, "0")}`;
}

// One visitor's tried requests, newest first, each with what the agent said, what
// the gate decided, and how it ended, read back from the logbook. No visitor, no tries.
export function recentTries(db: DatabaseSync, visitorId: string | null, limit = 20): Tried[] {
  if (visitorId === null) return [];
  ensureVisitorTable(db);
  const rows = db
    .prepare(
      `SELECT i.id, i.subject, i.body, c.name FROM inbox i
       JOIN customers c ON c.id = i.customer_id
       JOIN try_owners t ON t.request_id = i.id
       WHERE i.id LIKE 'TRY-%' AND t.visitor_id = ? ORDER BY CAST(SUBSTR(i.id, 5) AS INTEGER) DESC LIMIT ?`,
    )
    .all(visitorId, limit) as { id: string; subject: string; body: string; name: string }[];

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
