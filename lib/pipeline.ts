import type { DatabaseSync } from "node:sqlite";
import { type AskModel, runAgent } from "./agent.ts";
import { executeRefund, type Refusal } from "./executor.ts";
import type { AgentOutput, RuleId } from "./gate.ts";
import {
  checkNow,
  ensureLogbook,
  type GateDecisionDetails,
  type LogEntry,
  logGateDecision,
  logRefusal,
  readEntries,
} from "./logbook.ts";

// The pipeline: one Inbox request, start to finish.
//   agent (suggests) -> gate (decides, and writes it down) -> one of:
//     allow          -> executor (pays), which writes its own line
//     send to human  -> waits in the human queue (the approval screen is Step 7)
//     block          -> stops
// The agent only suggests. The only things handed on are a logbook line number
// (to the executor) and the gate's decision, never the agent's form itself.

export type PipelineResult =
  | { outcome: "unknown_request" } // not in the Inbox: nothing runs, nothing is written
  | { outcome: "already_processed"; gateEntryId: number } // each request runs once
  | { outcome: "not_recorded"; because: string } // R7: the logbook couldn't write, so nothing happened
  | { outcome: "paid"; gateEntryId: number; refundId: string }
  | { outcome: "nothing_to_pay"; gateEntryId: number } // the gate allowed a "no refund" answer
  | { outcome: "waiting_for_human"; gateEntryId: number; rules: RuleId[] }
  | { outcome: "blocked"; gateEntryId: number; rules: RuleId[] }
  | { outcome: "not_paid"; gateEntryId: number; because: Refusal; refusalLogged: boolean }; // allowed, but the executor refused

// A UTC time like 2026-10-05T14:03:11Z, the shape the logbook accepts.
export const utcNow = (): string => new Date().toISOString().slice(0, 19) + "Z";

// Each request runs once. Asking the agent takes a while, so the "already run?"
// check is repeated, locked, right before the gate's line is written: two runs
// of one request at the same moment end with exactly one gate line.
// R7: the gate's line is written before anything is handed out. If the logbook
// can't write it, this returns "not_recorded" and nothing else happens. The AI
// call itself changes nothing, and its answer is stored on the gate's line.
// If the executor throws (a busy database) after the gate allowed a refund,
// the error is passed on; calling this again for the same request pays it, because
// an allowed request with no payment and no refusal on record is handed to the
// executor again, and the executor pays each request at most once.
export async function processRequest(
  db: DatabaseSync,
  requestId: string,
  askModel: AskModel,
  now?: string,
): Promise<PipelineResult> {
  if (now !== undefined) checkNow(now); // a bad time is a programming mistake, not a logbook failure

  if (!db.prepare("SELECT 1 FROM inbox WHERE id = ?").get(requestId)) return { outcome: "unknown_request" };

  let earlier: LogEntry | undefined;
  try {
    earlier = firstGateLine(db, requestId);
  } catch (error) {
    return { outcome: "not_recorded", because: message(error) };
  }
  if (earlier) return resume(db, earlier, now ?? utcNow());

  const output = await runAgent(db, requestId, askModel);
  const at = now ?? utcNow();

  let gate;
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const raced = firstGateLine(db, requestId);
      if (raced) return { outcome: "already_processed", gateEntryId: raced.id };
      gate = logGateDecision(db, requestId, output, at);
      db.exec("COMMIT");
    } finally {
      if (db.isTransaction) db.exec("ROLLBACK");
    }
  } catch (error) {
    return { outcome: "not_recorded", because: message(error) };
  }

  const { entryId, decision } = gate;
  if (decision.result === "block") return { outcome: "blocked", gateEntryId: entryId, rules: decision.rules };
  if (decision.result === "send_to_human") {
    return { outcome: "waiting_for_human", gateEntryId: entryId, rules: decision.rules };
  }
  return pay(db, entryId, at);
}

// The request already has a gate line. If the gate allowed it and nothing was
// paid or refused afterwards, it was interrupted: hand it to the executor again.
function resume(db: DatabaseSync, gateLine: LogEntry, now: string): PipelineResult {
  const stored = gateLine.details as Partial<GateDecisionDetails> | null;
  if (stored?.decision?.result !== "allow") return { outcome: "already_processed", gateEntryId: gateLine.id };

  const settled = readEntries(db, gateLine.requestId).some(
    (line) => line.kind === "refund_done" || line.kind === "refund_refused",
  );
  if (settled) return { outcome: "already_processed", gateEntryId: gateLine.id };
  return pay(db, gateLine.id, now);
}

// Hands a gate "allow" line to the executor, and writes down a refusal.
function pay(db: DatabaseSync, gateEntryId: number, now: string): PipelineResult {
  const paid = executeRefund(db, gateEntryId, now);
  if (paid.result === "done") return { outcome: "paid", gateEntryId, refundId: paid.refundId };
  if (paid.because === "nothing_to_pay") return { outcome: "nothing_to_pay", gateEntryId };

  let refusalLogged = true;
  try {
    logRefusal(db, gateEntryId, paid.because, now);
  } catch {
    refusalLogged = false; // nothing was paid either way; the result says the refusal itself wasn't recorded
  }
  return { outcome: "not_paid", gateEntryId, because: paid.because, refusalLogged };
}

function firstGateLine(db: DatabaseSync, requestId: string): LogEntry | undefined {
  return readEntries(db, requestId).find((line) => line.kind === "gate_decision");
}

export type WaitingItem = {
  gateEntryId: number;
  requestId: string;
  waitingSince: string;
  rules: RuleId[];
  output: AgentOutput;
};

// The human queue: every request the gate sent to a person that no person has
// decided yet, oldest first. It is read straight from the logbook, so there is
// no second list that could disagree with the record. (A person's reject must be
// written as a "human_decision" line in Step 7, or it would stay in the queue.)
export function humanQueue(db: DatabaseSync): WaitingItem[] {
  ensureLogbook(db);
  const rows = db
    .prepare(
      `SELECT g.id, g.logged_at, g.request_id, g.details FROM logbook g
       WHERE g.kind = 'gate_decision'
         AND json_extract(g.details, '$.decision.result') = 'send_to_human'
         AND NOT EXISTS (SELECT 1 FROM logbook h WHERE h.kind = 'human_decision' AND h.refers_to = g.id)
       ORDER BY g.id`,
    )
    .all() as { id: number; logged_at: string; request_id: string; details: string }[];

  return rows.map((row) => {
    const details = JSON.parse(row.details) as GateDecisionDetails;
    return {
      gateEntryId: row.id,
      requestId: row.request_id,
      waitingSince: row.logged_at,
      rules: details.decision.rules,
      output: details.output,
    };
  });
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
