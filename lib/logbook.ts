import type { DatabaseSync } from "node:sqlite";
import { type AgentOutput, checkProposal, type GateDecision } from "./gate.ts";

// The logbook: an add-only record of every step. Lines are only ever added,
// never changed or deleted. Only the writers below, and the executor's own
// "refund done" line, add lines; there's deliberately no "add any line"
// function. A person's reject (with the note it needs) and holding the person
// to R1 come in Step 7, next to logHumanApproval, so the approval screen can't
// skip them.

// Kinds are listed here, not in the database, so a later step can add one
// without rebuilding a table that must never be dropped.
export type LogKind = "gate_decision" | "human_decision" | "refund_done";

export type LogEntry = {
  id: number;
  loggedAt: string;
  kind: string; // plain text: lines written by later steps may have other kinds
  requestId: string;
  refersTo: number | null;
  details: unknown;
};

export type GateDecisionDetails = { output: AgentOutput; decision: GateDecision };
export type HumanApproval = { decision: "approve"; orderId: string; amountCents: number };
export type RefundDoneDetails = {
  refundId: string;
  orderId: string;
  amountCents: number;
  refundedOn: string;
  reason: string;
};

const APPROVAL_FIELDS = ["amountCents", "decision", "orderId"]; // sorted

// The three triggers make the table add-only: changing, deleting, or
// overwriting a line (REPLACE INTO, INSERT OR REPLACE, upsert) all fail.
// There are no UNIQUE indexes on purpose: INSERT OR REPLACE against one would
// quietly delete the old line without firing the delete trigger. "Only once"
// rules are checked in code instead, while the database is locked.
// No links to the shop tables either, because reloading the shop data drops them.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS logbook (
    id         INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id > 0),
    logged_at  TEXT    NOT NULL,
    kind       TEXT    NOT NULL,
    request_id TEXT    NOT NULL,
    refers_to  INTEGER REFERENCES logbook(id),
    details    TEXT    NOT NULL CHECK (json_valid(details))
  );
  CREATE TRIGGER IF NOT EXISTS logbook_no_update BEFORE UPDATE ON logbook
    BEGIN SELECT RAISE(ABORT, 'The logbook is add-only'); END;
  CREATE TRIGGER IF NOT EXISTS logbook_no_delete BEFORE DELETE ON logbook
    BEGIN SELECT RAISE(ABORT, 'The logbook is add-only'); END;
  CREATE TRIGGER IF NOT EXISTS logbook_no_overwrite BEFORE INSERT ON logbook
    WHEN EXISTS (SELECT 1 FROM logbook WHERE id = NEW.id)
    BEGIN SELECT RAISE(ABORT, 'The logbook is add-only'); END;
`;

type Row = {
  id: number;
  logged_at: string;
  kind: string;
  request_id: string;
  refers_to: number | null;
  details: string;
};

// Creates the logbook if it isn't there yet. Safe to run any number of times;
// it never drops or changes an existing table. Every exported function that
// reads or writes the logbook runs it first, so no caller can forget it.
export function ensureLogbook(db: DatabaseSync): void {
  db.exec(SCHEMA);
}

// Only a UTC time like 2026-10-05T14:03:11Z is accepted, and it must be a real
// date: JavaScript would quietly turn 2026-02-30 into March 2. A bad date would
// be stored and then counted on the wrong day, or not at all, by R4. Returns the
// date part.
export function checkNow(now: string): string {
  const shapeOk = typeof now === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(now);
  const time = shapeOk ? new Date(now) : null;
  const realDate = time !== null && !Number.isNaN(time.getTime()) && time.toISOString() === now.slice(0, 19) + ".000Z";
  if (!realDate) throw new Error('"now" must be a UTC time like 2026-10-05T14:03:11Z');
  return now.slice(0, 10);
}

// Runs the gate on the agent's answer and writes the decision down. The gate
// checks the exact copy that gets stored, so the log always shows what the gate
// saw, even if the answer would read differently a second time.
// R7: if the line can't be written, this throws and no decision is handed out.
export function logGateDecision(
  db: DatabaseSync,
  requestId: string,
  output: AgentOutput,
  now: string,
): { entryId: number; decision: GateDecision } {
  checkNow(now);
  ensureLogbook(db);

  let outputJson: unknown;
  try {
    outputJson = JSON.stringify(output);
  } catch {
    outputJson = undefined;
  }
  if (typeof outputJson !== "string") throw new Error("The agent's answer can't be written down");

  const copy = JSON.parse(outputJson) as AgentOutput;
  const decision = checkProposal(db, requestId, copy); // an unknown request throws, and nothing is logged

  const details: GateDecisionDetails = { output: copy, decision };
  const entryId = addLine(db, now, "gate_decision", requestId, null, details);
  return { entryId, decision };
}

// One shared check on a person's approval, used here and again by the executor.
// Returns the problem in plain words, or null when everything is fine.
export function humanApprovalProblem(db: DatabaseSync, gateEntry: LogEntry, approval: unknown): string | null {
  ensureLogbook(db);
  if (gateEntry.kind !== "gate_decision") return `Line ${gateEntry.id} is not a gate decision`;

  const stored = gateEntry.details as Partial<GateDecisionDetails> | null;
  if (stored?.decision?.result !== "send_to_human") return "The gate didn't send this request to a person";

  if (typeof approval !== "object" || approval === null || Array.isArray(approval)) return "Not a valid approval";
  if (Object.keys(approval).sort().join() !== APPROVAL_FIELDS.join()) return "Not a valid approval";
  const { decision, orderId, amountCents } = approval as Record<string, unknown>;
  if (decision !== "approve") return "Not a valid approval";

  const hasOrder = typeof orderId === "string" && orderId.trim() !== "";
  if (!hasOrder || !db.prepare("SELECT 1 FROM orders WHERE id = ?").get(orderId)) {
    return "The approval must name an order that exists";
  }

  // Text like "$150.00" would be stored as-is and then left out of R1's sums.
  if (!Number.isSafeInteger(amountCents) || (amountCents as number) <= 0) {
    return "The amount must be a whole number of cents above zero";
  }

  // A person picks the order only when the form named none (the AI was down or
  // unsure). When the agent's refund form named an order, that's the one the
  // gate checked, so it's the only one the person can approve.
  const output = stored.output;
  if (output?.status === "answered") {
    const form = output.form as { action?: unknown; orderId?: unknown } | null;
    if (form?.action === "refund" && orderId !== form.orderId) {
      return "The person can only approve the order the gate checked";
    }
  }

  return null;
}

// Writes down a person's approval of a request the gate sent to a person.
// Every failure throws, and nothing is written. R7: if the line can't be
// written, the approval doesn't count.
export function logHumanApproval(
  db: DatabaseSync,
  gateEntryId: number,
  approval: HumanApproval,
  now: string,
): { entryId: number } {
  checkNow(now);
  ensureLogbook(db);

  // All checks run on a plain copy, which is exactly what gets stored.
  let approvalJson: unknown;
  try {
    approvalJson = JSON.stringify(approval);
  } catch {
    approvalJson = undefined;
  }
  if (typeof approvalJson !== "string") throw new Error("Not a valid approval");
  const copy: unknown = JSON.parse(approvalJson);

  // Locked while checking and writing, so two callers can't both pass "only once".
  db.exec("BEGIN IMMEDIATE");
  try {
    const gateEntry = readEntry(db, gateEntryId);
    if (!gateEntry) throw new Error(`No logbook line ${gateEntryId}`);

    const problem = humanApprovalProblem(db, gateEntry, copy);
    if (problem) throw new Error(problem);

    const earlier = db
      .prepare("SELECT 1 FROM logbook WHERE kind = 'human_decision' AND refers_to = ?")
      .get(gateEntryId);
    if (earlier) throw new Error(`Line ${gateEntryId} already has a person's decision`);

    const entryId = addLine(db, now, "human_decision", gateEntry.requestId, gateEntryId, copy);
    db.exec("COMMIT");
    return { entryId };
  } finally {
    if (db.isTransaction) db.exec("ROLLBACK");
  }
}

export function readEntry(db: DatabaseSync, id: number): LogEntry | undefined {
  ensureLogbook(db);
  const row = db.prepare("SELECT * FROM logbook WHERE id = ?").get(id) as Row | undefined;
  return row && toEntry(row);
}

// Every line, or one request's lines, oldest first.
export function readEntries(db: DatabaseSync, requestId?: string): LogEntry[] {
  ensureLogbook(db);
  const rows = (
    requestId === undefined
      ? db.prepare("SELECT * FROM logbook ORDER BY id").all()
      : db.prepare("SELECT * FROM logbook WHERE request_id = ? ORDER BY id").all(requestId)
  ) as Row[];
  return rows.map(toEntry);
}

// Adds one line and returns its number. Not exported, so only the writers above
// use it. The executor writes its own "refund done" line, inside its save.
function addLine(
  db: DatabaseSync,
  now: string,
  kind: LogKind,
  requestId: string,
  refersTo: number | null,
  details: unknown,
): number {
  const result = db
    .prepare("INSERT INTO logbook (logged_at, kind, request_id, refers_to, details) VALUES (?, ?, ?, ?, ?)")
    .run(now, kind, requestId, refersTo, JSON.stringify(details));
  return Number(result.lastInsertRowid);
}

function toEntry(row: Row): LogEntry {
  return {
    id: row.id,
    loggedAt: row.logged_at,
    kind: row.kind,
    requestId: row.request_id,
    refersTo: row.refers_to,
    details: JSON.parse(row.details),
  };
}
