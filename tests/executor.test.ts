import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../lib/db.ts";
import { executeRefund } from "../lib/executor.ts";
import { type AgentOutput } from "../lib/gate.ts";
import { ensureLogbook, logGateDecision, logHumanApproval, readEntries, readEntry } from "../lib/logbook.ts";
import { seed } from "../lib/seed.ts";

// The executor's tests use a stand-in agent: fixed forms written here, no AI calls.
// Each test gets its own fresh database, because these tests add refunds and triggers.
// Every refusal also checks that no refund was added.

const NOW = "2026-10-05T12:00:00Z";

function freshDb(): DatabaseSync {
  const db = openDatabase(":memory:");
  seed(db);
  ensureLogbook(db);
  return db;
}

const AI_DOWN: AgentOutput = { status: "ai_down" };

function answered(form: unknown): AgentOutput {
  return { status: "answered", form };
}

// A well-formed refund form.
function refundForm(orderId: string, amountCents: number): Record<string, unknown> {
  return { action: "refund", orderId, amountCents, reason: "Arrived damaged", policyLine: "P02" };
}

function refund(orderId: string, amountCents: number): AgentOutput {
  return answered(refundForm(orderId, amountCents));
}

// A refund form whose amount reads 2400 the first time and 400000 after that.
function shiftyRefund(orderId: string): AgentOutput {
  let reads = 0;
  const form = {
    action: "refund",
    orderId,
    get amountCents() {
      reads += 1;
      return reads === 1 ? 2400 : 400_000;
    },
    reason: "Arrived damaged",
    policyLine: "P02",
  };
  return answered(form);
}

// Logs the gate's decision, as Step 6 will, and returns the line number.
function gateLine(db: DatabaseSync, requestId: string, output: AgentOutput): number {
  return logGateDecision(db, requestId, output, NOW).entryId;
}

function approvalLine(db: DatabaseSync, gateEntryId: number, orderId: string, amountCents: number): number {
  return logHumanApproval(db, gateEntryId, { decision: "approve", orderId, amountCents }, NOW).entryId;
}

// A line written straight into the table, skipping the logbook's writers.
function rawLine(db: DatabaseSync, kind: string, requestId: string, refersTo: number | null, details: unknown): number {
  const result = db
    .prepare("INSERT INTO logbook (logged_at, kind, request_id, refers_to, details) VALUES (?, ?, ?, ?, ?)")
    .run(NOW, kind, requestId, refersTo, JSON.stringify(details));
  return Number(result.lastInsertRowid);
}

function refundRows(db: DatabaseSync) {
  return db.prepare("SELECT * FROM refunds ORDER BY id").all();
}

function linesOf(db: DatabaseSync, kind: string) {
  return readEntries(db).filter((line) => line.kind === kind);
}

const refusedFor = (because: string) => ({ result: "refused", because });

const BROKEN_LOG = "CREATE TRIGGER test_broken BEFORE INSERT ON logbook BEGIN SELECT RAISE(ABORT, 'log broken'); END";

describe("Done when, part 1: a proposal that skipped the gate is refused", () => {
  it("Executor: a proposal that skipped the gate is refused: the form handed in directly", () => {
    const db = freshDb();
    const before = refundRows(db);

    expect(executeRefund(db, refundForm("O1001", 2400) as unknown as number, NOW)).toEqual(refusedFor("not_approved"));
    expect(refundRows(db)).toEqual(before);
  });

  it("Executor: a proposal that skipped the gate is refused: a made-up line number (99999)", () => {
    const db = freshDb();
    const before = refundRows(db);

    expect(executeRefund(db, 99999, NOW)).toEqual(refusedFor("not_approved"));
    expect(refundRows(db)).toEqual(before);
  });

  it("Executor: a proposal that skipped the gate is refused: the gate said block (REQ-012, R1)", () => {
    const db = freshDb();
    const line = gateLine(db, "REQ-012", refund("O1024", 6000));
    const before = refundRows(db);

    expect(executeRefund(db, line, NOW)).toEqual(refusedFor("not_approved"));
    expect(refundRows(db)).toEqual(before);
  });

  it("Executor: a proposal that skipped the gate is refused: sent to a person, nobody approved (REQ-002)", () => {
    const db = freshDb();
    const line = gateLine(db, "REQ-002", refund("O1002", 15000));
    const before = refundRows(db);

    expect(executeRefund(db, line, NOW)).toEqual(refusedFor("not_approved"));
    expect(refundRows(db)).toEqual(before);
  });

  it('Executor: a proposal that skipped the gate is refused: an "allow" line the gate never wrote', () => {
    const db = freshDb();
    // $150 needs a person (R2), but this line says the gate allowed it.
    const line = rawLine(db, "gate_decision", "REQ-002", null, {
      output: refund("O1002", 15000),
      decision: { result: "allow", rules: [] },
    });
    const before = refundRows(db);

    expect(executeRefund(db, line, NOW)).toEqual(refusedFor("not_approved"));
    expect(refundRows(db)).toEqual(before);
  });

  it('Executor: a proposal that skipped the gate is refused: a "person\'s approval" of a request the gate blocked', () => {
    const db = freshDb();
    const blocked = gateLine(db, "REQ-012", refund("O1024", 6000));
    const line = rawLine(db, "human_decision", "REQ-012", blocked, {
      decision: "approve",
      orderId: "O1024",
      amountCents: 4500,
    });
    const before = refundRows(db);

    expect(executeRefund(db, line, NOW)).toEqual(refusedFor("not_approved"));
    expect(refundRows(db)).toEqual(before);
  });

  it("Executor: a proposal that skipped the gate is refused: a second, raw-inserted person's approval for the same gate line", () => {
    const db = freshDb();
    const toPerson = gateLine(db, "REQ-002", refund("O1002", 15000));
    approvalLine(db, toPerson, "O1002", 5000);
    const second = rawLine(db, "human_decision", "REQ-002", toPerson, {
      decision: "approve",
      orderId: "O1002",
      amountCents: 15000,
    });
    const before = refundRows(db);

    expect(executeRefund(db, second, NOW)).toEqual(refusedFor("not_approved"));
    expect(refundRows(db)).toEqual(before);
  });

  it("Executor: a proposal that skipped the gate is refused: a raw person's approval whose request differs from its gate line's", () => {
    const db = freshDb();
    const toPerson = gateLine(db, "REQ-002", refund("O1002", 15000));
    const line = rawLine(db, "human_decision", "REQ-001", toPerson, {
      decision: "approve",
      orderId: "O1002",
      amountCents: 5000,
    });
    const before = refundRows(db);

    expect(executeRefund(db, line, NOW)).toEqual(refusedFor("not_approved"));
    expect(refundRows(db)).toEqual(before);
  });

  it("Executor: a proposal that skipped the gate is refused: a raw person's approval with no gate line", () => {
    const db = freshDb();
    const line = rawLine(db, "human_decision", "REQ-002", null, {
      decision: "approve",
      orderId: "O1002",
      amountCents: 5000,
    });
    const before = refundRows(db);

    expect(executeRefund(db, line, NOW)).toEqual(refusedFor("not_approved"));
    expect(refundRows(db)).toEqual(before);
  });

  it("Executor: a raw-inserted 'reject' line is not paid (REQ-002)", () => {
    const db = freshDb();
    const toPerson = gateLine(db, "REQ-002", refund("O1002", 15000));
    const line = rawLine(db, "human_decision", "REQ-002", toPerson, {
      decision: "reject",
      orderId: "O1002",
      amountCents: 15000,
    });
    const before = refundRows(db);

    expect(executeRefund(db, line, NOW)).toEqual(refusedFor("not_approved"));
    expect(refundRows(db)).toEqual(before);
  });

  it("Executor: a proposal that skipped the gate is refused: a raw-inserted person's approval with a bad amount, another order, or an unknown order (REQ-002)", () => {
    const approvals = [
      { decision: "approve", orderId: "O1002", amountCents: "$150.00" },
      { decision: "approve", orderId: "O1001", amountCents: 1000 },
      { decision: "approve", orderId: "O9999", amountCents: 1000 },
    ];
    for (const approval of approvals) {
      const db = freshDb();
      const toPerson = gateLine(db, "REQ-002", refund("O1002", 15000));
      const line = rawLine(db, "human_decision", "REQ-002", toPerson, approval);
      const before = refundRows(db);

      expect(executeRefund(db, line, NOW), JSON.stringify(approval)).toEqual(refusedFor("not_approved"));
      expect(refundRows(db)).toEqual(before);
    }
  });

  it('Executor: a proposal that skipped the gate is refused: an "allow" line for a request that isn\'t in the Inbox (REQ-999)', () => {
    const db = freshDb();
    const line = rawLine(db, "gate_decision", "REQ-999", null, {
      output: refund("O1001", 2400),
      decision: { result: "allow", rules: [] },
    });
    const before = refundRows(db);

    expect(executeRefund(db, line, NOW)).toEqual(refusedFor("not_approved"));
    expect(refundRows(db)).toEqual(before);
    expect(linesOf(db, "refund_done")).toEqual([]);
  });

  it('Executor: a "refund done" line is not an approval', () => {
    const db = freshDb();
    const line = gateLine(db, "REQ-001", refund("O1001", 1000));
    const paid = executeRefund(db, line, NOW);
    expect(paid.result).toBe("done");
    const doneLine = (paid as { entryId: number }).entryId;
    const before = refundRows(db);

    expect(executeRefund(db, doneLine, NOW)).toEqual(refusedFor("not_approved"));
    expect(refundRows(db)).toEqual(before);
  });
});

// Positive controls: these stop an executor that refuses everything from passing.
describe("Executor: approved refunds are paid, once", () => {
  it("Executor: a gate-allowed refund is paid once (REQ-001, $24.00)", () => {
    const db = freshDb();
    const line = gateLine(db, "REQ-001", refund("O1001", 2400));

    const paid = executeRefund(db, line, NOW);
    expect(paid).toEqual({ result: "done", refundId: "RF016", entryId: expect.any(Number) });
    expect(db.prepare("SELECT * FROM refunds WHERE id = 'RF016'").get()).toEqual({
      id: "RF016",
      order_id: "O1001",
      refunded_on: "2026-10-05",
      amount_cents: 2400,
      reason: "Arrived damaged",
    });

    const done = linesOf(db, "refund_done");
    expect(done).toHaveLength(1);
    expect(done[0]).toEqual({
      id: (paid as { entryId: number }).entryId,
      loggedAt: NOW,
      kind: "refund_done",
      requestId: "REQ-001",
      refersTo: line,
      details: { refundId: "RF016", orderId: "O1001", amountCents: 2400, refundedOn: "2026-10-05", reason: "Arrived damaged" },
    });
  });

  it("Executor: paying the same approval twice is refused (already_done)", () => {
    const db = freshDb();
    // The full $24.00, so a second try would also break R1: already_done must be found first.
    const line = gateLine(db, "REQ-001", refund("O1001", 2400));
    expect(executeRefund(db, line, NOW).result).toBe("done");
    const before = refundRows(db);

    expect(executeRefund(db, line, NOW)).toEqual(refusedFor("already_done"));
    expect(refundRows(db)).toEqual(before);
  });

  it("Executor: a second gate approval for the same request is refused (REQ-001, $10.00 twice)", () => {
    const db = freshDb();
    const first = gateLine(db, "REQ-001", refund("O1001", 1000));
    const second = gateLine(db, "REQ-001", refund("O1001", 1000));
    expect(executeRefund(db, first, NOW).result).toBe("done");
    const before = refundRows(db);

    expect(executeRefund(db, second, NOW)).toEqual(refusedFor("already_done"));
    expect(refundRows(db)).toEqual(before);
  });

  it("Executor: an old person's approval for a request already paid is refused (REQ-001)", () => {
    const db = freshDb();
    const down = gateLine(db, "REQ-001", AI_DOWN);
    const personLine = approvalLine(db, down, "O1001", 1000);
    const retry = gateLine(db, "REQ-001", refund("O1001", 1000));
    expect(executeRefund(db, retry, NOW).result).toBe("done");
    const before = refundRows(db);

    expect(executeRefund(db, personLine, NOW)).toEqual(refusedFor("already_done"));
    expect(refundRows(db)).toEqual(before);
  });

  it("R2: a $150 refund approved by a person is paid with the person's amount (REQ-002)", () => {
    const db = freshDb();
    const toPerson = gateLine(db, "REQ-002", refund("O1002", 15000));
    const personLine = approvalLine(db, toPerson, "O1002", 12000);

    expect(executeRefund(db, personLine, NOW)).toEqual({ result: "done", refundId: "RF016", entryId: expect.any(Number) });
    expect(db.prepare("SELECT * FROM refunds WHERE id = 'RF016'").get()).toEqual({
      id: "RF016",
      order_id: "O1002",
      refunded_on: "2026-10-05",
      amount_cents: 12000,
      reason: `Approved by a person (logbook line ${personLine})`,
    });
  });

  it("R6: a person's approval after the AI was down is paid (REQ-001)", () => {
    const db = freshDb();
    const down = gateLine(db, "REQ-001", AI_DOWN);
    const personLine = approvalLine(db, down, "O1001", 2400);

    expect(executeRefund(db, personLine, NOW)).toEqual({ result: "done", refundId: "RF016", entryId: expect.any(Number) });
    expect(db.prepare("SELECT order_id, amount_cents FROM refunds WHERE id = 'RF016'").get()).toEqual({
      order_id: "O1001",
      amount_cents: 2400,
    });
  });

  it("Executor: an allowed no-refund answer pays nothing (REQ-021)", () => {
    const db = freshDb();
    const form = { action: "no_refund", orderId: "O1034", amountCents: null, reason: "Asks about delivery", policyLine: "P07" };
    const line = gateLine(db, "REQ-021", answered(form));
    const before = refundRows(db);

    expect(executeRefund(db, line, NOW)).toEqual(refusedFor("nothing_to_pay"));
    expect(refundRows(db)).toEqual(before);
    expect(linesOf(db, "refund_done")).toHaveLength(0);
  });

  it("Executor: what is paid is exactly what the gate saw", () => {
    const db = freshDb();
    const line = gateLine(db, "REQ-002", shiftyRefund("O1002"));

    expect(executeRefund(db, line, NOW).result).toBe("done");
    expect(db.prepare("SELECT order_id, amount_cents FROM refunds WHERE id = 'RF016'").get()).toEqual({
      order_id: "O1002",
      amount_cents: 2400,
    });
  });
});

describe("Done when, part 2: a broken log means no refund (R7)", () => {
  it("R7: a broken logbook means no refund", () => {
    const db = freshDb();
    const line = gateLine(db, "REQ-001", refund("O1001", 2400));
    db.exec(BROKEN_LOG);
    const before = refundRows(db);

    expect(executeRefund(db, line, NOW)).toEqual(refusedFor("R7"));
    expect(refundRows(db)).toEqual(before);
    expect(linesOf(db, "refund_done")).toHaveLength(0);

    // The broken log was the only reason: once it's fixed, the same line pays.
    db.exec("DROP TRIGGER test_broken");
    expect(executeRefund(db, line, NOW)).toEqual({ result: "done", refundId: "RF016", entryId: expect.any(Number) });
  });

  it("R7: a full logbook means no refund", () => {
    const db = freshDb();
    const line = gateLine(db, "REQ-001", refund("O1001", 2400));
    // The largest line number SQLite allows has been used, so no new line fits.
    db.exec("UPDATE sqlite_sequence SET seq = 9223372036854775807 WHERE name = 'logbook'");
    const before = refundRows(db);

    expect(executeRefund(db, line, NOW)).toEqual(refusedFor("R7"));
    expect(refundRows(db)).toEqual(before);
    expect(linesOf(db, "refund_done")).toHaveLength(0);
    expect(db.isTransaction).toBe(false);
  });

  it("R7: if the refund can't be saved, the logbook doesn't claim it", () => {
    const db = freshDb();
    const line = gateLine(db, "REQ-001", refund("O1001", 2400));
    db.exec("CREATE TRIGGER test_refunds_broken BEFORE INSERT ON refunds BEGIN SELECT RAISE(ABORT, 'refunds broken'); END");
    const before = refundRows(db);

    expect(() => executeRefund(db, line, NOW)).toThrow("refunds broken");
    expect(refundRows(db)).toEqual(before);
    expect(linesOf(db, "refund_done")).toHaveLength(0);
    expect(readEntries(db).map((entry) => entry.id)).toEqual([line]);
    expect(db.isTransaction).toBe(false);
  });
});

describe("R1 at the moment of paying", () => {
  it("R1: two allowed refunds that together pass the amount paid: the second is refused at payment (O1001)", () => {
    const db = freshDb();
    // Each is allowed on its own: $15.00 of $24.00. Together they'd be $30.00.
    const first = gateLine(db, "REQ-001", refund("O1001", 1500));
    const second = gateLine(db, "REQ-022", refund("O1001", 1500));
    expect(readEntry(db, second)!.details).toMatchObject({ decision: { result: "allow" } });

    expect(executeRefund(db, first, NOW).result).toBe("done");
    const before = refundRows(db);
    expect(executeRefund(db, second, NOW)).toEqual(refusedFor("R1"));
    expect(refundRows(db)).toEqual(before);
  });

  it("R1: a person's approval is refused at payment if the order no longer has that much left (O1002)", () => {
    const db = freshDb();
    const toPerson = gateLine(db, "REQ-002", refund("O1002", 15000));
    const personLine = approvalLine(db, toPerson, "O1002", 15000);
    const other = gateLine(db, "REQ-001", refund("O1002", 5000));
    expect(executeRefund(db, other, NOW).result).toBe("done");
    const before = refundRows(db);

    expect(executeRefund(db, personLine, NOW)).toEqual(refusedFor("R1"));
    expect(refundRows(db)).toEqual(before);
  });
});

describe("Executor: other", () => {
  it("Executor: refund numbers never repeat, even after the shop data is reloaded", () => {
    const db = freshDb();
    const first = gateLine(db, "REQ-001", refund("O1001", 2400));
    expect(executeRefund(db, first, NOW)).toMatchObject({ result: "done", refundId: "RF016" });

    seed(db);
    const second = gateLine(db, "REQ-003", refund("O1003", 10000));
    expect(executeRefund(db, second, NOW)).toMatchObject({ result: "done", refundId: "RF017" });
  });

  it("Executor: refund numbers keep counting past RF999", () => {
    const db = freshDb();
    db.prepare(
      "INSERT INTO refunds (id, order_id, refunded_on, amount_cents, reason) VALUES ('RF999', 'O1005', '2026-10-01', 100, 'Test setup')",
    ).run();
    const first = gateLine(db, "REQ-001", refund("O1001", 2400));
    expect(executeRefund(db, first, NOW)).toMatchObject({ result: "done", refundId: "RF1000" });
    const second = gateLine(db, "REQ-003", refund("O1003", 10000));
    expect(executeRefund(db, second, NOW)).toMatchObject({ result: "done", refundId: "RF1001" });
  });

  it("Executor: a bad time is refused before anything changes", () => {
    const db = freshDb();
    const line = gateLine(db, "REQ-001", refund("O1001", 2400));
    const before = refundRows(db);

    expect(() => executeRefund(db, line, "2026-13-01T00:00:00Z")).toThrow(
      '"now" must be a UTC time like 2026-10-05T14:03:11Z',
    );
    expect(refundRows(db)).toEqual(before);
    expect(linesOf(db, "refund_done")).toHaveLength(0);
  });
});
