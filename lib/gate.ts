import type { DatabaseSync } from "node:sqlite";

// The gate: plain code, no AI. It checks the agent's answer to one Inbox request
// against the hard rules in docs/RULES.md and returns one result, naming the
// rules behind it. It checks R1 to R6 and R8 to R14; R7 belongs to the logbook and executor.

export type RuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R8" | "R9" | "R10" | "R11" | "R12" | "R13" | "R14";

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
const R13_HUMAN_ABOVE_CENTS = 15000; // R13: more than $150 to one customer
const R13_WINDOW_DAYS = 90; // in the same window as R4, counting the refund asked for
const R10_NEW_ACCOUNT_DAYS = 30; // joined 30 days or fewer before the request (Q8)

type Request = { customer_id: string; received_on: string; subject: string; body: string };
type Order = { customer_id: string; placed_on: string; amount_paid_cents: number; in_transit: number };

// When several rules apply, the strictest result wins (block, then send to
// human, then allow), and every rule behind that result is named (Q4).
export function checkProposal(db: DatabaseSync, requestId: string, output: AgentOutput): GateDecision {
  const request = db.prepare("SELECT customer_id, received_on, subject, body FROM inbox WHERE id = ?").get(requestId) as
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
  // R12 (Q10): turning a customer away over an order number that isn't theirs needs a person to check it.
  // R14: an email asking about two or more of the customer's orders needs a person too.
  if (form.action === "no_refund") {
    const rules = orderRules(db, request);
    return rules.length > 0 ? { result: "send_to_human", rules } : { result: "allow", rules: [] };
  }

  // R5: a refund on an order that doesn't exist can't be checked or carried out.
  const order = db
    .prepare("SELECT customer_id, placed_on, amount_paid_cents, in_transit FROM orders WHERE id = ?")
    .get(form.orderId) as Order | undefined;
  if (!order) return { result: "block", rules: ["R5"] };

  const blocking: RuleId[] = [];
  const needsHuman: RuleId[] = [];
  const alreadyRefunded = refundedCents(db, form.orderId);
  if (!isCents(order.amount_paid_cents) || form.amountCents > order.amount_paid_cents - alreadyRefunded) blocking.push("R1");
  // R8: the order must belong to the customer who asked (policy line P06 made a hard rule).
  if (order.customer_id !== request.customer_id) blocking.push("R8");
  if (form.amountCents > R2_HUMAN_ABOVE_CENTS) needsHuman.push("R2");
  // R3: a request dated before its order, or a date that can't be read, can't be called fresh either.
  const age = daysBetween(order.placed_on, request.received_on);
  if (age === null || age < 0 || age > R3_HUMAN_ABOVE_DAYS) needsHuman.push("R3");
  if (recentRefunds(db, request) >= R4_HUMAN_AT_REFUNDS) needsHuman.push("R4");
  // R9 (Q7): a second refund on one order, so splitting a big refund into small ones or sending the same claim twice reaches a person.
  if (hasRefund(db, form.orderId) || waitingOnOrder(db, form.orderId)) needsHuman.push("R9");
  if (accountNeedsALook(db, request)) needsHuman.push("R10");
  // R11 (Q9): the carrier hasn't delivered the order yet, so a damage or "never arrived" claim can't be checked.
  if (order.in_transit !== 0) needsHuman.push("R11"); // anything but a plain 0 (delivered) gets a look
  // R13: refunds stacked across a customer's orders, each under R2's line, still reach a person past $150.
  const earlier = refundedToCustomer(db, request);
  if (earlier > 0 && earlier + form.amountCents > R13_HUMAN_ABOVE_CENTS) needsHuman.push("R13");
  needsHuman.push(...orderRules(db, request));

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
// An amount that isn't a whole number of cents above zero (text stored in the column, say)
// makes the total unknowable, so it counts as everything: R1 then blocks any further refund.
export function refundedCents(db: DatabaseSync, orderId: string): number {
  const rows = db.prepare("SELECT amount_cents FROM refunds WHERE order_id = ?").all(orderId) as { amount_cents: unknown }[];
  if (rows.some((r) => !isCents(r.amount_cents))) return Number.POSITIVE_INFINITY;
  return rows.reduce((sum, r) => sum + (r.amount_cents as number), 0);
}

const isCents = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

// R9 (Q7): another request on this order is already waiting for a person.
function hasRefund(db: DatabaseSync, orderId: string): boolean {
  return db.prepare("SELECT 1 FROM refunds WHERE order_id = ? LIMIT 1").get(orderId) !== undefined;
}

function waitingOnOrder(db: DatabaseSync, orderId: string): boolean {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'logbook'").get()) return false;
  const row = db
    .prepare(
      `SELECT 1 FROM logbook g
       WHERE g.kind = 'gate_decision'
         AND json_extract(g.details, '$.decision.result') = 'send_to_human'
         AND json_extract(g.details, '$.output.form.orderId') = ?
         AND NOT EXISTS (SELECT 1 FROM logbook h WHERE h.kind = 'human_decision' AND h.refers_to = g.id)
       LIMIT 1`,
    )
    .get(orderId);
  return row !== undefined;
}

// The order numbers a message names, as shop IDs (O plus digits). Plain text matching, no AI.
// The text is cleaned first so disguises read as the number they stand for: full-width and
// other look-alike characters, accents, invisible and direction characters, other scripts'
// digits, a Cyrillic or Greek O. Then "O1002", "O-1002", "0rder 01002", "order #1,002",
// "Order No. 1002" and a bare "#1002" all count as O1002. A written-out number ("one oh
// oh two") or a bare 1002 isn't caught here; the agent is told to answer unsure for those.
export function namedOrderIds(subject: string, body: string): Set<string> {
  const text = `${subject}\n${body}`;
  const named = new Set<string>();
  const cleaned = clean(text);
  // A right-to-left override shows the text backwards on screen, so read it both ways.
  const readings = /[\u202e\u2067]/.test(text) ? [cleaned, [...cleaned].reverse().join("")] : [cleaned];
  for (const reading of readings) {
    for (const m of [...reading.matchAll(ORDER_NUMBER), ...reading.matchAll(GLUED_TO_A_WORD)]) {
      const digits = (m[1] ?? m[2]).replace(/,/g, "").replace(/^0+(?=\d{4})/, "");
      named.add(`O${digits}`);
    }
  }
  return named;
}

const ORDER_NUMBER = /(?<![A-Z0-9])(?:[O0]RDER|[O0]RD|[O0])\.?\s*(?:NO\.?|NUMBER|#)?\s*[-#:._]?\s*(\d[\d,]{3,})(?!\d)|#\s*(\d{4,})(?!\d)/gi;
// A capital O right after a lowercase word ("#refundO1002"). Case matters here, so "photo2024" isn't one.
const GLUED_TO_A_WORD = /(?<=[a-z])O(\d{4,})(?!\d)/g;
const LOOKS_LIKE_O = /[\u041e\u043e\u039f\u03bf\u0555\u10ff\u2c9e\u2c9f]/g; // Cyrillic, Greek, Armenian, Georgian, Coptic O

function clean(text: string): string {
  return text
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\p{Cf}/gu, "")
    .replace(/\p{Nd}/gu, (d) => (/[0-9]/.test(d) ? d : String(digitValue(d))))
    .replace(LOOKS_LIKE_O, "O");
}

// The value of a decimal digit from any script: digits come in runs of ten, starting at 0.
function digitValue(d: string): number {
  const code = d.codePointAt(0)!;
  for (let zero = code; zero > code - 10; zero--) {
    if (!/\p{Nd}/u.test(String.fromCodePoint(zero - 1))) return code - zero;
  }
  return 0;
}

// R12 (Q10) and R14: what the order numbers in the message say. R12: one isn't the asking
// customer's (doesn't exist, someone else's, a typo). R14: two or more of their own are named.
function orderRules(db: DatabaseSync, request: Request): RuleId[] {
  const named = namedOrderIds(request.subject, request.body);
  if (named.size === 0) return [];
  const own = new Set((db.prepare("SELECT id FROM orders WHERE customer_id = ?").all(request.customer_id) as { id: string }[]).map((o) => o.id));
  const rules: RuleId[] = [];
  if ([...named].some((id) => !own.has(id))) rules.push("R12");
  if ([...named].filter((id) => own.has(id)).length >= 2) rules.push("R14");
  return rules;
}

// R10 (Q8): the account is flagged, or joined 30 days or fewer before the request.
function accountNeedsALook(db: DatabaseSync, request: Request): boolean {
  const customer = db.prepare("SELECT joined_on, flagged FROM customers WHERE id = ?").get(request.customer_id) as
    | { joined_on: string; flagged: number }
    | undefined;
  if (!customer) return true;
  // An account that joined after the request was sent, or with no readable join date, counts as new.
  const days = daysBetween(customer.joined_on, request.received_on);
  return customer.flagged !== 0 || days === null || days <= R10_NEW_ACCOUNT_DAYS;
}

// R4 (Q3): the asking customer's refunds, on any of their orders, made 0 to 90
// days before the request arrived. The refund being asked for isn't one of them.
function recentRefunds(db: DatabaseSync, request: Request): number {
  const rows = db
    .prepare("SELECT r.refunded_on FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.customer_id = ?")
    .all(request.customer_id) as { refunded_on: string }[];
  return rows.filter((row) => inWindow(row.refunded_on, request.received_on, R4_WINDOW_DAYS)).length;
}

// R13: cents already refunded to the asking customer, on any of their orders, in the
// 90 days before the request (the same window as R4).
function refundedToCustomer(db: DatabaseSync, request: Request): number {
  const rows = db
    .prepare("SELECT r.refunded_on, r.amount_cents FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.customer_id = ?")
    .all(request.customer_id) as { refunded_on: string; amount_cents: number }[];
  return rows.filter((row) => inWindow(row.refunded_on, request.received_on, R13_WINDOW_DAYS)).reduce((sum, row) => sum + row.amount_cents, 0);
}

// An earlier refund counts toward R4 and R13 when it's 90 days old or less. One dated after
// the request still counts: it was paid while this request waited, so it's just as recent.
// An unreadable date counts too, so a bad row can't hide a refund.
function inWindow(refundedOn: string, receivedOn: string, windowDays: number): boolean {
  const days = daysBetween(refundedOn, receivedOn);
  return days === null || days <= windowDays;
}

// Whole days from one YYYY-MM-DD date to another, or null when either isn't a real date in
// that exact form. Date.parse alone would read "2026-02-30" as March 2, add half a day for a
// time of day, and give NaN for anything else, and NaN fails every limit check silently.
function daysBetween(from: string, to: string): number | null {
  if (!isDay(from) || !isDay(to)) return null;
  return (Date.parse(to) - Date.parse(from)) / 86_400_000;
}

function isDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
