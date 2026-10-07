import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../lib/db.ts";
import { type AgentOutput, checkProposal } from "../lib/gate.ts";
import {
  ensureLogbook,
  type HumanApproval,
  logGateDecision,
  logHumanApproval,
  readEntries,
  readEntry,
} from "../lib/logbook.ts";
import { seed } from "../lib/seed.ts";

// The logbook's tests use a stand-in agent: fixed forms written here, no AI calls.
// Each test gets its own fresh database, because these tests add lines and triggers.

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

function refund(orderId: string, amountCents: number): AgentOutput {
  return answered({ action: "refund", orderId, amountCents, reason: "Arrived damaged", policyLine: "P02" });
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

function approve(orderId: string, amountCents: number): HumanApproval {
  return { decision: "approve", orderId, amountCents };
}

function linesOf(db: DatabaseSync, kind: string) {
  return readEntries(db).filter((line) => line.kind === kind);
}

const BROKEN_LOG = "CREATE TRIGGER test_broken BEFORE INSERT ON logbook BEGIN SELECT RAISE(ABORT, 'log broken'); END";

describe("logbook: gate decisions", () => {
  it("Logbook: a gate decision is written with the agent's answer and the gate's result (REQ-001)", () => {
    const db = freshDb();
    const output = refund("O1001", 2400);
    const { entryId, decision } = logGateDecision(db, "REQ-001", output, NOW);

    expect(decision).toEqual(checkProposal(db, "REQ-001", output));
    expect(readEntry(db, entryId)).toEqual({
      id: entryId,
      loggedAt: NOW,
      kind: "gate_decision",
      requestId: "REQ-001",
      refersTo: null,
      details: { output, decision },
    });
  });

  it("Logbook: the line holds exactly the form the gate checked, even if the form changes when read again", () => {
    const db = freshDb();
    const { entryId, decision } = logGateDecision(db, "REQ-002", shiftyRefund("O1002"), NOW);

    expect(decision).toEqual({ result: "allow", rules: [] });
    const details = readEntry(db, entryId)!.details as { output: { form: { amountCents: number } } };
    expect(details.output.form.amountCents).toBe(2400);
  });

  it("R7: if the logbook can't write, logGateDecision throws and hands out no decision", () => {
    const db = freshDb();
    db.exec(BROKEN_LOG);

    expect(() => logGateDecision(db, "REQ-001", refund("O1001", 2400), NOW)).toThrow("log broken");
    expect(readEntries(db)).toHaveLength(0);
  });
});

describe("logbook: add-only", () => {
  it("Logbook: add-only: changing a line is refused", () => {
    const db = freshDb();
    const { entryId } = logGateDecision(db, "REQ-001", refund("O1001", 2400), NOW);
    const before = readEntry(db, entryId);

    expect(() => db.exec(`UPDATE logbook SET request_id = 'REQ-999' WHERE id = ${entryId}`)).toThrow(
      "The logbook is add-only",
    );
    expect(readEntry(db, entryId)).toEqual(before);
  });

  it("Logbook: add-only: deleting a line is refused", () => {
    const db = freshDb();
    const { entryId } = logGateDecision(db, "REQ-001", refund("O1001", 2400), NOW);
    const before = readEntry(db, entryId);

    expect(() => db.exec(`DELETE FROM logbook WHERE id = ${entryId}`)).toThrow("The logbook is add-only");
    expect(readEntry(db, entryId)).toEqual(before);
  });

  it("Logbook: add-only: REPLACE INTO, INSERT OR REPLACE and upsert can't overwrite a line", () => {
    const db = freshDb();
    const { entryId } = logGateDecision(db, "REQ-001", refund("O1001", 2400), NOW);
    const before = readEntry(db, entryId);
    const values = `(${entryId}, '${NOW}', 'gate_decision', 'REQ-999', NULL, '{}')`;
    const columns = "(id, logged_at, kind, request_id, refers_to, details)";

    expect(() => db.exec(`REPLACE INTO logbook ${columns} VALUES ${values}`)).toThrow("The logbook is add-only");
    expect(() => db.exec(`INSERT OR REPLACE INTO logbook ${columns} VALUES ${values}`)).toThrow(
      "The logbook is add-only",
    );
    expect(() =>
      db.exec(`INSERT INTO logbook ${columns} VALUES ${values} ON CONFLICT (id) DO UPDATE SET request_id = 'REQ-999'`),
    ).toThrow("The logbook is add-only");
    expect(readEntries(db)).toEqual([before]);
  });

  it("Logbook: add-only: a line with a made-up negative number is refused", () => {
    const db = freshDb();

    expect(() =>
      db.exec(
        `INSERT INTO logbook (id, logged_at, kind, request_id, refers_to, details) VALUES (-5, '${NOW}', 'gate_decision', 'REQ-001', NULL, '{}')`,
      ),
    ).toThrow("CHECK constraint failed");
    expect(readEntries(db)).toHaveLength(0);
  });

  it("Logbook: a line that isn't valid JSON is refused", () => {
    const db = freshDb();
    logGateDecision(db, "REQ-001", refund("O1001", 2400), NOW);

    expect(() =>
      db.exec(
        `INSERT INTO logbook (logged_at, kind, request_id, refers_to, details) VALUES ('${NOW}', 'gate_decision', 'REQ-001', NULL, 'not json')`,
      ),
    ).toThrow();
    expect(readEntries(db)).toHaveLength(1);
  });

  it("Logbook: setting up again, or reloading the shop data, keeps every line", () => {
    const db = freshDb();
    logGateDecision(db, "REQ-001", refund("O1001", 2400), NOW);
    logGateDecision(db, "REQ-002", refund("O1002", 15000), NOW);
    const before = readEntries(db);

    ensureLogbook(db);
    ensureLogbook(db);
    seed(db);

    expect(readEntries(db)).toEqual(before);
    expect(before).toHaveLength(2);
  });

  it("Logbook: the writers set up the logbook themselves", () => {
    const db = openDatabase(":memory:");
    seed(db);

    const { entryId } = logGateDecision(db, "REQ-001", refund("O1001", 2400), NOW);
    expect(readEntry(db, entryId)?.kind).toBe("gate_decision");
  });

  it("Logbook: one request's lines come back alone, oldest first", () => {
    const db = freshDb();
    const first = logGateDecision(db, "REQ-001", refund("O1001", 2400), NOW).entryId;
    logGateDecision(db, "REQ-002", refund("O1002", 15000), NOW);
    const third = logGateDecision(db, "REQ-001", refund("O1001", 1000), NOW).entryId;

    expect(readEntries(db, "REQ-001").map((line) => line.id)).toEqual([first, third]);
  });
});

describe("logbook: a person's approval", () => {
  it("Logbook: a person's approval is only written for a line the gate sent to a person", () => {
    const db = freshDb();
    const allowLine = logGateDecision(db, "REQ-001", refund("O1001", 2400), NOW);
    const blockLine = logGateDecision(db, "REQ-012", refund("O1024", 6000), NOW);
    expect(allowLine.decision.result).toBe("allow");
    expect(blockLine.decision).toEqual({ result: "block", rules: ["R1"] });

    expect(() => logHumanApproval(db, allowLine.entryId, approve("O1001", 2400), NOW)).toThrow(
      "The gate didn't send this request to a person",
    );
    expect(() => logHumanApproval(db, blockLine.entryId, approve("O1024", 4500), NOW)).toThrow(
      "The gate didn't send this request to a person",
    );
    expect(linesOf(db, "human_decision")).toHaveLength(0);
  });

  it("Logbook: only one person's decision per gate line (REQ-002)", () => {
    const db = freshDb();
    const { entryId } = logGateDecision(db, "REQ-002", refund("O1002", 15000), NOW);
    logHumanApproval(db, entryId, approve("O1002", 15000), NOW);

    expect(() => logHumanApproval(db, entryId, approve("O1002", 12000), NOW)).toThrow(
      `Line ${entryId} already has a person's decision`,
    );
    expect(linesOf(db, "human_decision")).toHaveLength(1);
  });

  it("Logbook: a person's amount must be a whole number of cents above zero", () => {
    const db = freshDb();
    const { entryId } = logGateDecision(db, "REQ-002", refund("O1002", 15000), NOW);

    for (const amount of ["$150.00", 150.5, 0, -100, Number.NaN]) {
      const approval = { decision: "approve", orderId: "O1002", amountCents: amount } as unknown as HumanApproval;
      expect(() => logHumanApproval(db, entryId, approval, NOW), String(amount)).toThrow(
        "The amount must be a whole number of cents above zero",
      );
    }
    expect(linesOf(db, "human_decision")).toHaveLength(0);
  });

  it("Logbook: an approval with an extra field is not valid", () => {
    const db = freshDb();
    const { entryId } = logGateDecision(db, "REQ-002", refund("O1002", 15000), NOW);
    const approval = { decision: "approve", orderId: "O1002", amountCents: 15000, note: "x" } as unknown as HumanApproval;

    expect(() => logHumanApproval(db, entryId, approval, NOW)).toThrow("Not a valid approval");
    expect(linesOf(db, "human_decision")).toHaveLength(0);
  });

  it("Logbook: a person's 'reject' is not an approval (REQ-002)", () => {
    const db = freshDb();
    const { entryId } = logGateDecision(db, "REQ-002", refund("O1002", 15000), NOW);
    const reject = { decision: "reject", orderId: "O1002", amountCents: 15000 } as unknown as HumanApproval;

    expect(() => logHumanApproval(db, entryId, reject, NOW)).toThrow("Not a valid approval");
    expect(linesOf(db, "human_decision")).toHaveLength(0);
  });

  it("Logbook: a person's approval is checked and stored as one plain copy, even if it reads differently a second time", () => {
    // Amounts that read one way the first time and another way after that.
    function shiftyApproval(firstRead: unknown, laterReads: unknown): HumanApproval {
      let reads = 0;
      return {
        decision: "approve",
        orderId: "O1002",
        get amountCents() {
          reads += 1;
          return reads === 1 ? firstRead : laterReads;
        },
      } as unknown as HumanApproval;
    }

    // Valid first, bad later: the valid copy is checked and stored.
    const db = freshDb();
    const toPerson = logGateDecision(db, "REQ-002", refund("O1002", 15000), NOW).entryId;
    const { entryId } = logHumanApproval(db, toPerson, shiftyApproval(12000, "$150.00"), NOW);
    expect(readEntry(db, entryId)!.details).toEqual(approve("O1002", 12000));

    // Bad first, valid later: the bad copy is checked, so nothing is written.
    const db2 = freshDb();
    const toPerson2 = logGateDecision(db2, "REQ-002", refund("O1002", 15000), NOW).entryId;
    expect(() => logHumanApproval(db2, toPerson2, shiftyApproval("$150.00", 12000), NOW)).toThrow(
      "The amount must be a whole number of cents above zero",
    );
    expect(linesOf(db2, "human_decision")).toHaveLength(0);
  });

  it("Logbook: a person's approval must name an order that exists", () => {
    const db = freshDb();
    const { entryId } = logGateDecision(db, "REQ-001", AI_DOWN, NOW);

    for (const orderId of ["O9999", "", "  "]) {
      expect(() => logHumanApproval(db, entryId, approve(orderId, 2400), NOW), orderId).toThrow(
        "The approval must name an order that exists",
      );
    }
    expect(linesOf(db, "human_decision")).toHaveLength(0);
  });

  it("Logbook: for a refund form, the person can only approve the order the gate checked (REQ-002)", () => {
    const db = freshDb();
    const { entryId } = logGateDecision(db, "REQ-002", refund("O1002", 15000), NOW);

    expect(() => logHumanApproval(db, entryId, approve("O1001", 2400), NOW)).toThrow(
      "The person can only approve the order the gate checked",
    );
    expect(linesOf(db, "human_decision")).toHaveLength(0);
  });

  it("R6: after the AI was down, the person names the order (REQ-001)", () => {
    const db = freshDb();
    const gateLine = logGateDecision(db, "REQ-001", AI_DOWN, NOW);
    expect(gateLine.decision).toEqual({ result: "send_to_human", rules: ["R6"] });

    const { entryId } = logHumanApproval(db, gateLine.entryId, approve("O1001", 2400), NOW);
    expect(readEntry(db, entryId)).toEqual({
      id: entryId,
      loggedAt: NOW,
      kind: "human_decision",
      requestId: "REQ-001",
      refersTo: gateLine.entryId,
      details: approve("O1001", 2400),
    });
  });

  it("R7: if the logbook can't write, a person's approval isn't recorded", () => {
    const db = freshDb();
    const { entryId } = logGateDecision(db, "REQ-002", refund("O1002", 15000), NOW);
    db.exec(BROKEN_LOG);

    expect(() => logHumanApproval(db, entryId, approve("O1002", 15000), NOW)).toThrow("log broken");
    expect(linesOf(db, "human_decision")).toHaveLength(0);
    expect(db.isTransaction).toBe(false);
  });
});

describe("logbook: the time", () => {
  it("Logbook: a bad time is refused before anything is written", () => {
    const db = freshDb();
    const { entryId } = logGateDecision(db, "REQ-002", refund("O1002", 15000), NOW);

    for (const now of ["2026-02-30T00:00:00Z", "2026-10-05", "", "2026-10-05T12:00:00.000Z", "2026-10-05T12:00:00+00:00"]) {
      expect(() => logGateDecision(db, "REQ-001", refund("O1001", 2400), now), now).toThrow(
        '"now" must be a UTC time like 2026-10-05T14:03:11Z',
      );
      expect(() => logHumanApproval(db, entryId, approve("O1002", 15000), now), now).toThrow(
        '"now" must be a UTC time like 2026-10-05T14:03:11Z',
      );
    }
    expect(readEntries(db)).toHaveLength(1);
  });
});
