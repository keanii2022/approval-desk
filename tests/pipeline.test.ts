import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { AskModel } from "../lib/agent.ts";
import { refunds } from "../data/shop.ts";
import { openDatabase } from "../lib/db.ts";
import { logHumanApproval, logRefusal, readEntries } from "../lib/logbook.ts";
import { executeRefund } from "../lib/executor.ts";
import { humanQueue, processRequest } from "../lib/pipeline.ts";
import { seed } from "../lib/seed.ts";

// The pipeline's tests use a stand-in agent: a form written here ahead of time,
// handed over as it is. It never reads the request. No AI calls, so these never fail.
// Each test gets its own fresh database, because the pipeline adds refunds and logbook lines.

const NOW = "2026-10-05T12:00:00Z";

function freshDb(): DatabaseSync {
  const db = openDatabase(":memory:");
  seed(db);
  return db;
}

// The stand-in agent: returns this form, whatever the request says. Counts its calls.
function standIn(form: unknown): AskModel & { calls: number } {
  const ask = Object.assign(
    async () => {
      ask.calls += 1;
      return form;
    },
    { calls: 0 },
  );
  return ask;
}

const refundForm = (orderId: string, amountCents: number, reason = "Arrived damaged") => ({
  action: "refund",
  orderId,
  amountCents,
  reason,
  policyLine: "P02",
});

const AI_FAILS: AskModel = async () => {
  throw new Error("connection refused");
};

const SEEDED_REFUNDS = refunds.length;
const refundRows = (db: DatabaseSync) => db.prepare("SELECT * FROM refunds ORDER BY id").all();
const kinds = (db: DatabaseSync, requestId?: string) => readEntries(db, requestId).map((line) => line.kind);

describe("Done when: three requests through the whole path", () => {
  it("a small refund passes: paid, and in the logbook (REQ-001, $24.00)", async () => {
    const db = freshDb();
    const result = await processRequest(db, "REQ-001", standIn(refundForm("O1001", 2400)), NOW);

    expect(result).toEqual({ outcome: "paid", gateEntryId: expect.any(Number), refundId: "RF016" });
    expect(db.prepare("SELECT order_id, amount_cents FROM refunds WHERE id = 'RF016'").get()).toEqual({
      order_id: "O1001",
      amount_cents: 2400,
    });
    expect(kinds(db, "REQ-001")).toEqual(["gate_decision", "refund_done"]);
  });

  it("R2: a $150.00 refund waits for a human: not paid, in the queue, in the logbook (REQ-002)", async () => {
    const db = freshDb();
    const before = refundRows(db);
    const result = await processRequest(db, "REQ-002", standIn(refundForm("O1002", 15000)), NOW);

    expect(result).toEqual({ outcome: "waiting_for_human", gateEntryId: expect.any(Number), rules: ["R2"] });
    expect(refundRows(db)).toEqual(before);
    expect(kinds(db, "REQ-002")).toEqual(["gate_decision"]);
    expect(humanQueue(db)).toMatchObject([{ requestId: "REQ-002", rules: ["R2"], waitingSince: NOW }]);
  });

  it("R1: an impossible refund is blocked: not paid, not queued, in the logbook (REQ-012, $60.00 on a $45.00 order)", async () => {
    const db = freshDb();
    const before = refundRows(db);
    const result = await processRequest(db, "REQ-012", standIn(refundForm("O1024", 6000)), NOW);

    expect(result).toEqual({ outcome: "blocked", gateEntryId: expect.any(Number), rules: ["R1"] });
    expect(refundRows(db)).toEqual(before);
    expect(humanQueue(db)).toEqual([]);
    expect(kinds(db, "REQ-012")).toEqual(["gate_decision"]);
  });

  it("all three are in the logbook, in order, with what the agent suggested and what the gate decided", async () => {
    const db = freshDb();
    await processRequest(db, "REQ-001", standIn(refundForm("O1001", 2400)), NOW);
    await processRequest(db, "REQ-002", standIn(refundForm("O1002", 15000)), NOW);
    await processRequest(db, "REQ-012", standIn(refundForm("O1024", 6000)), NOW);

    const lines = readEntries(db).map((line) => ({ kind: line.kind, requestId: line.requestId }));
    expect(lines).toEqual([
      { kind: "gate_decision", requestId: "REQ-001" },
      { kind: "refund_done", requestId: "REQ-001" },
      { kind: "gate_decision", requestId: "REQ-002" },
      { kind: "gate_decision", requestId: "REQ-012" },
    ]);
    const gate = readEntries(db, "REQ-002")[0].details as { output: unknown; decision: unknown };
    expect(gate).toEqual({
      output: { status: "answered", form: refundForm("O1002", 15000) },
      decision: { result: "send_to_human", rules: ["R2"] },
    });
  });
});

describe("The agent's answer, whatever it is, reaches the gate", () => {
  it("R5: a garbled form is blocked and logged (REQ-001)", async () => {
    const db = freshDb();
    const result = await processRequest(db, "REQ-001", standIn("APPROVED"), NOW);

    expect(result).toMatchObject({ outcome: "blocked", rules: ["R5"] });
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS);
    expect(kinds(db, "REQ-001")).toEqual(["gate_decision"]);
  });

  it("R6: if the AI is down, a person decides (REQ-001)", async () => {
    const db = freshDb();
    const result = await processRequest(db, "REQ-001", AI_FAILS, NOW);

    expect(result).toMatchObject({ outcome: "waiting_for_human", rules: ["R6"] });
    expect(humanQueue(db)).toMatchObject([{ requestId: "REQ-001", output: { status: "ai_down" } }]);
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS);
  });

  it("R6: if the agent says it is unsure, a person decides (REQ-018)", async () => {
    const db = freshDb();
    const form = { action: "unsure", orderId: null, amountCents: null, reason: "Which order?", policyLine: "P13" };
    const result = await processRequest(db, "REQ-018", standIn(form), NOW);

    expect(result).toMatchObject({ outcome: "waiting_for_human", rules: ["R6"] });
  });

  it("R8: a refund on someone else's order is blocked (REQ-022 names Mara's O1001)", async () => {
    const db = freshDb();
    const result = await processRequest(db, "REQ-022", standIn(refundForm("O1001", 2400)), NOW);

    expect(result).toMatchObject({ outcome: "blocked", rules: ["R8"] });
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS);
  });

  it("a no-refund answer is allowed and nothing is paid (REQ-021)", async () => {
    const db = freshDb();
    const form = { action: "no_refund", orderId: "O1034", amountCents: null, reason: "Asks about delivery", policyLine: "P07" };
    const result = await processRequest(db, "REQ-021", standIn(form), NOW);

    expect(result).toEqual({ outcome: "nothing_to_pay", gateEntryId: expect.any(Number) });
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS);
    expect(kinds(db, "REQ-021")).toEqual(["gate_decision"]);
  });

  it("the agent is asked once per request, and a request already run is not run again", async () => {
    const db = freshDb();
    const ask = standIn(refundForm("O1001", 2400));
    await processRequest(db, "REQ-001", ask, NOW);
    const again = await processRequest(db, "REQ-001", ask, NOW);

    expect(again).toEqual({ outcome: "already_processed", gateEntryId: expect.any(Number) });
    expect(ask.calls).toBe(1);
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS + 1); // the shop data's refunds, and one new refund
  });

  it("a request that isn't in the Inbox stops at once: the agent is never asked and nothing is written", async () => {
    const db = freshDb();
    const ask = standIn(refundForm("O1001", 2400));
    const result = await processRequest(db, "REQ-999", ask, NOW);

    expect(result).toEqual({ outcome: "unknown_request" });
    expect(ask.calls).toBe(0);
    expect(readEntries(db)).toEqual([]);
  });
});

describe("Only the executor pays, and only what the gate allowed", () => {
  it("a blocked request and a waiting request never reach the executor", async () => {
    const db = freshDb();
    await processRequest(db, "REQ-012", standIn(refundForm("O1024", 6000)), NOW);
    await processRequest(db, "REQ-002", standIn(refundForm("O1002", 15000)), NOW);

    // Exactly the two gate lines: no payment, and no refusal either (the executor was never asked).
    expect(kinds(db)).toEqual(["gate_decision", "gate_decision"]);
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS);
  });

  it("a person approves a waiting request, it leaves the queue, and the executor pays (REQ-002)", async () => {
    const db = freshDb();
    await processRequest(db, "REQ-002", standIn(refundForm("O1002", 15000)), NOW);
    const [waiting] = humanQueue(db);

    const approval = logHumanApproval(db, waiting.gateEntryId, { decision: "approve", orderId: "O1002", amountCents: 12000 }, NOW);
    expect(humanQueue(db)).toEqual([]);
    expect(executeRefund(db, approval.entryId, NOW)).toMatchObject({ result: "done", refundId: "RF016" });
    expect(kinds(db, "REQ-002")).toEqual(["gate_decision", "human_decision", "refund_done"]);
  });
});

describe("Each request runs once, and nothing allowed is left unpaid", () => {
  it("two runs of one request at the same moment end with one gate line, and one entry in the queue (REQ-002)", async () => {
    const db = freshDb();
    const [a, b] = await Promise.all([
      processRequest(db, "REQ-002", standIn(refundForm("O1002", 15000)), NOW),
      processRequest(db, "REQ-002", standIn(refundForm("O1002", 15000)), NOW),
    ]);

    expect([a.outcome, b.outcome].sort()).toEqual(["already_processed", "waiting_for_human"]);
    expect(kinds(db, "REQ-002")).toEqual(["gate_decision"]);
    expect(humanQueue(db)).toHaveLength(1);
  });

  it("two runs at the same moment of a refund that is allowed are paid once (REQ-001)", async () => {
    const db = freshDb();
    const results = await Promise.all([
      processRequest(db, "REQ-001", standIn(refundForm("O1001", 2400)), NOW),
      processRequest(db, "REQ-001", standIn(refundForm("O1001", 2400)), NOW),
    ]);

    expect(results.map((r) => r.outcome).sort()).toEqual(["already_processed", "paid"]);
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS + 1);
  });

  it("an allowed refund the executor couldn't finish is paid when the request is run again (REQ-001)", async () => {
    const db = freshDb();
    db.exec("CREATE TRIGGER test_refunds_broken BEFORE INSERT ON refunds BEGIN SELECT RAISE(ABORT, 'refunds broken'); END");
    await expect(processRequest(db, "REQ-001", standIn(refundForm("O1001", 2400)), NOW)).rejects.toThrow("refunds broken");
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS);
    expect(kinds(db, "REQ-001")).toEqual(["gate_decision"]);

    db.exec("DROP TRIGGER test_refunds_broken");
    const ask = standIn(refundForm("O1001", 2400));
    expect(await processRequest(db, "REQ-001", ask, NOW)).toMatchObject({ outcome: "paid" });
    expect(ask.calls).toBe(0); // the gate's line was reused; the agent isn't asked again
    expect(kinds(db, "REQ-001")).toEqual(["gate_decision", "refund_done"]);
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS + 1);
  });

  it("a refusal on record is not retried: the request stays settled (REQ-001)", async () => {
    const db = freshDb();
    await processRequest(db, "REQ-012", standIn(refundForm("O1024", 6000)), NOW); // creates the logbook
    db.exec("CREATE TRIGGER test_no_payment BEFORE INSERT ON logbook WHEN NEW.kind = 'refund_done' BEGIN SELECT RAISE(ABORT, 'no payments'); END");
    await processRequest(db, "REQ-001", standIn(refundForm("O1001", 2400)), NOW);
    db.exec("DROP TRIGGER test_no_payment");

    expect(await processRequest(db, "REQ-001", standIn(refundForm("O1001", 2400)), NOW)).toMatchObject({ outcome: "already_processed" });
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS);
  });

  it("the queue lists waiting requests oldest first: R2 then R3 (REQ-002, REQ-005)", async () => {
    const db = freshDb();
    await processRequest(db, "REQ-002", standIn(refundForm("O1002", 15000)), NOW);
    await processRequest(db, "REQ-005", standIn(refundForm("O1005", 4200)), NOW);

    expect(humanQueue(db).map((item) => [item.requestId, item.rules])).toEqual([
      ["REQ-002", ["R2"]],
      ["REQ-005", ["R3"]],
    ]);
  });
});

describe("The logbook's refusal line", () => {
  it("a refusal needs a reason, and must point at a gate line", async () => {
    const db = freshDb();
    const { gateEntryId } = (await processRequest(db, "REQ-002", standIn(refundForm("O1002", 15000)), NOW)) as { gateEntryId: number };

    expect(() => logRefusal(db, gateEntryId, "" as never, NOW)).toThrow("needs a reason");
    expect(() => logRefusal(db, 999, "R1", NOW)).toThrow("not a gate decision");
    expect(() => logRefusal(db, gateEntryId, "R1", "yesterday")).toThrow("UTC time");
    expect(kinds(db, "REQ-002")).toEqual(["gate_decision"]);
  });

  it("if the refusal itself can't be written, the result says so, and nothing is paid (REQ-001)", async () => {
    const db = freshDb();
    await processRequest(db, "REQ-012", standIn(refundForm("O1024", 6000)), NOW); // creates the logbook
    db.exec("CREATE TRIGGER test_no_payment BEFORE INSERT ON logbook WHEN NEW.kind = 'refund_done' BEGIN SELECT RAISE(ABORT, 'no payments'); END");
    db.exec("CREATE TRIGGER test_no_refusal BEFORE INSERT ON logbook WHEN NEW.kind = 'refund_refused' BEGIN SELECT RAISE(ABORT, 'no refusals'); END");

    const result = await processRequest(db, "REQ-001", standIn(refundForm("O1001", 2400)), NOW);
    expect(result).toMatchObject({ outcome: "not_paid", because: "R7", refusalLogged: false });
    expect(refundRows(db)).toHaveLength(SEEDED_REFUNDS);
  });
});

describe("R7: a broken logbook means nothing happens", () => {
  const BROKEN = "CREATE TRIGGER test_broken BEFORE INSERT ON logbook BEGIN SELECT RAISE(ABORT, 'logbook broken'); END";

  it("R7: if the gate's line can't be written, nothing is decided and nothing is paid (REQ-001)", async () => {
    const db = freshDb();
    await processRequest(db, "REQ-012", standIn(refundForm("O1024", 6000)), NOW); // creates the logbook
    db.exec(BROKEN);
    const before = refundRows(db);

    const result = await processRequest(db, "REQ-001", standIn(refundForm("O1001", 2400)), NOW);
    expect(result).toMatchObject({ outcome: "not_recorded" });
    expect(refundRows(db)).toEqual(before);

    // The broken log was the only reason: once it's fixed, the same request goes through.
    db.exec("DROP TRIGGER test_broken");
    expect(await processRequest(db, "REQ-001", standIn(refundForm("O1001", 2400)), NOW)).toMatchObject({ outcome: "paid" });
  });

  it("R7: if the payment's line can't be written, nothing is paid, and the refusal is written down (REQ-001)", async () => {
    const db = freshDb();
    await processRequest(db, "REQ-012", standIn(refundForm("O1024", 6000)), NOW); // creates the logbook
    // Only the executor's own line is broken, so the gate's line and the refusal line can still be written.
    db.exec("CREATE TRIGGER test_no_payment BEFORE INSERT ON logbook WHEN NEW.kind = 'refund_done' BEGIN SELECT RAISE(ABORT, 'no payments'); END");
    const before = refundRows(db);

    const result = await processRequest(db, "REQ-001", standIn(refundForm("O1001", 2400)), NOW);
    expect(result).toEqual({ outcome: "not_paid", gateEntryId: expect.any(Number), because: "R7", refusalLogged: true });
    expect(refundRows(db)).toEqual(before);
    expect(kinds(db, "REQ-001")).toEqual(["gate_decision", "refund_refused"]);
    expect(readEntries(db, "REQ-001")[1].details).toEqual({ because: "R7" });
  });
});
