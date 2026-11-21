import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { AskModel } from "../lib/agent.ts";
import { approveAndPay } from "../lib/approval.ts";
import { openDatabase } from "../lib/db.ts";
import { executeRefund } from "../lib/executor.ts";
import { logGateDecision, readEntries } from "../lib/logbook.ts";
import { processRequest, type PipelineResult } from "../lib/pipeline.ts";
import { seed } from "../lib/seed.ts";

// Step 29: requests that arrive at the same moment. The worry is that two
// requests both pass a gate check (R9, R4) before either refund is written down.
// "Paid with no person" counts refunds whose logbook line points at a gate line,
// not at a person's approval. Stand-in agents only, no AI calls.
//
// Two kinds of "at once":
//   - processRequest calls run together with Promise.all, on one connection and on
//     two connections to one SQLite file (two server requests in one process).
//   - two processes: the gate's line commits, then the executor takes its own lock,
//     so another process can slip in between. Node can't pause processRequest there,
//     so those tests run the same steps by hand in the worst order.

const NOW = "2026-10-05T12:00:00Z";
const RECEIVED = "2026-10-05"; // same day as NOW, so a refund paid now counts toward R4 (Q3: 0 to 90 days before)

const refundForm = (orderId: string, amountCents: number) => ({
  action: "refund",
  orderId,
  amountCents,
  reason: "Arrived damaged",
  policyLine: "P02",
});
const answered = (form: unknown) => ({ status: "answered" as const, form });

// A stand-in agent that answers after `ms`, so the order the answers come back in is chosen.
const after = (ms: number, form: unknown): AskModel => async () => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return form;
};

function addRequests(db: DatabaseSync, customerId: string, ids: string[]): void {
  const insert = db.prepare(
    "INSERT INTO inbox (id, customer_id, received_on, subject, body) VALUES (?, ?, ?, 'Damaged', 'It arrived damaged. Refund please.')",
  );
  for (const id of ids) insert.run(id, customerId, RECEIVED);
}

// An invented customer with two refunds in the last 90 days (one short of R4)
// and three clean $90 orders.
function addNearlyR4Customer(db: DatabaseSync): void {
  db.prepare("INSERT INTO customers (id, name, email) VALUES ('C900', 'Wren Halloway', 'wren.halloway@example.com')").run();
  const order = db.prepare("INSERT INTO orders (id, customer_id, placed_on, item, amount_paid_cents) VALUES (?, 'C900', ?, ?, ?)");
  order.run("O9001", "2026-08-01", "Clay plant pot", 2000);
  order.run("O9002", "2026-08-15", "Linen napkins (4)", 2000);
  order.run("O9003", "2026-09-25", "Oak bread board", 9000);
  order.run("O9004", "2026-09-25", "Glass fruit bowl", 9000);
  order.run("O9005", "2026-09-25", "Wool rug", 9000);
  const refund = db.prepare("INSERT INTO refunds (id, order_id, refunded_on, amount_cents, reason) VALUES (?, ?, ?, ?, 'Arrived damaged')");
  refund.run("RF901", "O9001", "2026-08-05", 2000);
  refund.run("RF902", "O9002", "2026-08-20", 2000);
}

function paidWithNoPerson(db: DatabaseSync): number {
  return readEntries(db).filter((line) => {
    if (line.kind !== "refund_done" || line.refersTo === null) return false;
    return readEntries(db).find((other) => other.id === line.refersTo)?.kind === "gate_decision";
  }).length;
}

const count = (results: PipelineResult[], outcome: PipelineResult["outcome"]) =>
  results.filter((result) => result.outcome === outcome).length;

// Two connections need a real file. It lives in data/ (where *.db is ignored) and is removed after each test.
const files: string[] = [];
function twoConnections(): [DatabaseSync, DatabaseSync] {
  const path = `data/concurrency-${randomUUID()}.db`;
  files.push(path);
  const first = openDatabase(path);
  seed(first);
  return [first, openDatabase(path)];
}
afterEach(() => {
  for (const path of files.splice(0)) for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
});

function memoryDb(): DatabaseSync {
  const db = openDatabase(":memory:");
  seed(db);
  return db;
}

describe("R9: two requests on one order at the same moment", () => {
  it("R9: two at once on one connection, at most one is paid with no person", async () => {
    const db = memoryDb();
    addRequests(db, "C001", ["REQ-X1", "REQ-X2"]);
    const results = await Promise.all([
      processRequest(db, "REQ-X1", after(5, refundForm("O1001", 1000)), NOW),
      processRequest(db, "REQ-X2", after(5, refundForm("O1001", 1000)), NOW),
    ]);

    expect(paidWithNoPerson(db)).toBe(1);
    expect(count(results, "paid")).toBe(1);
    expect(results.find((result) => result.outcome !== "paid")).toMatchObject({ outcome: "waiting_for_human", rules: ["R9"] });
  });

  it("R9: ten at once on one connection, answers coming back in reverse order: one paid, nine wait for a person", async () => {
    const db = memoryDb();
    const ids = Array.from({ length: 10 }, (_, i) => `REQ-X${i + 1}`);
    addRequests(db, "C001", ids);
    const results = await Promise.all(ids.map((id, i) => processRequest(db, id, after(20 - 2 * i, refundForm("O1001", 200)), NOW)));

    expect(paidWithNoPerson(db)).toBe(1);
    expect(count(results, "paid")).toBe(1);
    expect(count(results, "waiting_for_human")).toBe(9);
  });

  it("R9: ten at once on two connections to one file: one paid, nine wait for a person", async () => {
    const [first, second] = twoConnections();
    const ids = Array.from({ length: 10 }, (_, i) => `REQ-X${i + 1}`);
    addRequests(first, "C001", ids);
    const results = await Promise.all(
      ids.map((id, i) => processRequest(i % 2 ? second : first, id, after(i % 3, refundForm("O1001", 200)), NOW)),
    );

    expect(paidWithNoPerson(first)).toBe(1);
    expect(count(results, "paid")).toBe(1);
    expect(count(results, "waiting_for_human")).toBe(9);
  });

  it("R9: two processes, both gate lines written before either pays: the executor pays only one", () => {
    const [first, second] = twoConnections();
    addRequests(first, "C001", ["REQ-X1", "REQ-X2"]);

    const gateA = logGateDecision(first, "REQ-X1", answered(refundForm("O1001", 1000)), NOW);
    const gateB = logGateDecision(second, "REQ-X2", answered(refundForm("O1001", 1000)), NOW);
    expect([gateA.decision.result, gateB.decision.result]).toEqual(["allow", "allow"]); // the window is real

    const paidA = executeRefund(first, gateA.entryId, NOW);
    const paidB = executeRefund(second, gateB.entryId, NOW);

    expect(paidA.result).toBe("done");
    expect(paidB).toEqual({ result: "refused", because: "not_approved" }); // its gate re-run inside the lock now says R9
    expect(paidWithNoPerson(first)).toBe(1);
  });

  it("R9: ten processes, all gate lines written before any pays: one paid", () => {
    const [first, second] = twoConnections();
    const ids = Array.from({ length: 10 }, (_, i) => `REQ-X${i + 1}`);
    addRequests(first, "C001", ids);

    const gates = ids.map((id, i) => logGateDecision(i % 2 ? second : first, id, answered(refundForm("O1001", 200)), NOW));
    expect(gates.every((gate) => gate.decision.result === "allow")).toBe(true);
    const paid = gates.map((gate, i) => executeRefund(i % 2 ? first : second, gate.entryId, NOW));

    expect(paid.filter((result) => result.result === "done")).toHaveLength(1);
    expect(paidWithNoPerson(first)).toBe(1);
  });
});

describe("R4: requests on different orders that together reach 3 refunds", () => {
  it("R4: two at once on two connections, customer one refund short of R4: one paid, the other waits for a person", async () => {
    const [first, second] = twoConnections();
    addNearlyR4Customer(first);
    addRequests(first, "C900", ["REQ-Y1", "REQ-Y2"]);
    const results = await Promise.all([
      processRequest(first, "REQ-Y1", after(3, refundForm("O9003", 2000)), NOW),
      processRequest(second, "REQ-Y2", after(3, refundForm("O9004", 2000)), NOW),
    ]);

    expect(paidWithNoPerson(first)).toBe(1);
    expect(results.find((result) => result.outcome !== "paid")).toMatchObject({ outcome: "waiting_for_human", rules: ["R4"] });
  });

  it("R4: two processes, both gate lines written before either pays: the executor pays only one", () => {
    const [first, second] = twoConnections();
    addNearlyR4Customer(first);
    addRequests(first, "C900", ["REQ-Y1", "REQ-Y2"]);

    const gateA = logGateDecision(first, "REQ-Y1", answered(refundForm("O9003", 2000)), NOW);
    const gateB = logGateDecision(second, "REQ-Y2", answered(refundForm("O9004", 2000)), NOW);
    expect([gateA.decision.result, gateB.decision.result]).toEqual(["allow", "allow"]);

    expect(executeRefund(second, gateB.entryId, NOW).result).toBe("done");
    expect(executeRefund(first, gateA.entryId, NOW)).toEqual({ result: "refused", because: "not_approved" });
    expect(paidWithNoPerson(first)).toBe(1);
  });
});

describe("A person's approval racing an automatic payout on one order", () => {
  // O1002 was paid $150. REQ-X1 asks $120 (R2, a person), REQ-X2 asks $20.
  it("R9: the big one is already waiting, the small one arrives: it waits for a person too", async () => {
    const [first, second] = twoConnections();
    addRequests(first, "C002", ["REQ-X1", "REQ-X2"]);
    const big = logGateDecision(first, "REQ-X1", answered(refundForm("O1002", 12000)), NOW);
    expect(big.decision).toMatchObject({ result: "send_to_human", rules: ["R2"] });

    const small = await processRequest(second, "REQ-X2", after(1, refundForm("O1002", 2000)), NOW);
    expect(small).toMatchObject({ outcome: "waiting_for_human", rules: ["R9"] });
    expect(paidWithNoPerson(first)).toBe(0);
  });

  it("R9: small allowed in another process before the big one waited; person pays $120 first: the small one is refused", async () => {
    const [first, second] = twoConnections();
    addRequests(first, "C002", ["REQ-X1", "REQ-X2"]);
    const small = logGateDecision(second, "REQ-X2", answered(refundForm("O1002", 2000)), NOW);
    const big = logGateDecision(first, "REQ-X1", answered(refundForm("O1002", 12000)), NOW);
    expect(small.decision.result).toBe("allow");
    expect(big.decision).toMatchObject({ result: "send_to_human", rules: ["R2"] });

    expect(approveAndPay(first, big.entryId, { orderId: "O1002", amount: "120.00" }, NOW)).toMatchObject({ outcome: "paid" });
    expect(executeRefund(second, small.entryId, NOW)).toEqual({ result: "refused", because: "not_approved" });
    expect(paidWithNoPerson(first)).toBe(0);
  });

  it("R1: small paid first, then the person approves the full $150: refused, only $130 is left", async () => {
    const [first, second] = twoConnections();
    addRequests(first, "C002", ["REQ-X1", "REQ-X2"]);
    const small = logGateDecision(second, "REQ-X2", answered(refundForm("O1002", 2000)), NOW);
    expect(executeRefund(second, small.entryId, NOW).result).toBe("done");
    const big = logGateDecision(first, "REQ-X1", answered(refundForm("O1002", 12000)), NOW);
    expect(big.decision).toMatchObject({ result: "send_to_human", rules: ["R2", "R9"] });

    const person = approveAndPay(first, big.entryId, { orderId: "O1002", amount: "150.00" }, NOW);
    expect(person.ok && person.outcome === "paid").toBe(false);
    const total = first.prepare("SELECT SUM(amount_cents) AS total FROM refunds WHERE order_id = 'O1002'").get() as { total: number };
    expect(total.total).toBe(2000);
  });
});

describe("stacking past $150 across orders at the same moment (R13)", () => {
  // Before R13 both $90 refunds were paid with no person. The executor re-runs the gate
  // inside its own write lock, so the second one sees the first and R13 sends it to a person.
  it("R13: two $90 refunds on different orders at once: one is paid, the other waits", async () => {
    const [first, second] = twoConnections();
    first.prepare("INSERT INTO customers (id, name, email) VALUES ('C901', 'Ines Barrowfield', 'ines.barrowfield@example.com')").run();
    const order = first.prepare("INSERT INTO orders (id, customer_id, placed_on, item, amount_paid_cents) VALUES (?, 'C901', '2026-09-25', 'Lamp', 9000)");
    order.run("O9011");
    order.run("O9012");
    addRequests(first, "C901", ["REQ-Z1", "REQ-Z2"]);
    const results = await Promise.all([
      processRequest(first, "REQ-Z1", after(2, refundForm("O9011", 9000)), NOW),
      processRequest(second, "REQ-Z2", after(2, refundForm("O9012", 9000)), NOW),
    ]);
    expect(count(results, "paid")).toBe(1);
  });
});
