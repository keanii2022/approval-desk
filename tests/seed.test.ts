import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { inbox } from "../data/inbox.ts";
import { policyLines } from "../data/policy.ts";
import { customers, orders, refunds } from "../data/shop.ts";
import { SEEDED_TABLES } from "../lib/seed.ts";

const dir = mkdtempSync(join(tmpdir(), "approval-desk-seed-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function runSeedScript(path: string): void {
  execFileSync(process.execPath, ["scripts/seed.ts", path]);
}

// Every table's definition and every row, in a fixed order.
function readEverything(path: string) {
  const db = new DatabaseSync(path);
  const tables = db.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all();
  const rows = Object.fromEntries(
    SEEDED_TABLES.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]),
  );
  db.close();
  return { tables, rows };
}

describe("seed script", () => {
  it("gives identical data when run twice", () => {
    const path = join(dir, "twice.db");
    runSeedScript(path);
    const first = readEverything(path);
    runSeedScript(path);
    const second = readEverything(path);

    expect(second).toEqual(first);
  });

  it("gives the same data in a brand-new database", () => {
    const a = join(dir, "a.db");
    const b = join(dir, "b.db");
    runSeedScript(a);
    runSeedScript(a);
    runSeedScript(b);

    expect(readEverything(b)).toEqual(readEverything(a));
  });

  it("loads every customer, order, refund, policy line, and Inbox request", () => {
    const path = join(dir, "counts.db");
    runSeedScript(path);
    const { rows } = readEverything(path);

    expect(rows.customers).toHaveLength(customers.length);
    expect(rows.orders).toHaveLength(orders.length);
    expect(rows.refunds).toHaveLength(refunds.length);
    expect(rows.policy_lines).toHaveLength(policyLines.length);
    expect(rows.inbox).toHaveLength(inbox.length);
  });
});
