import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AskModel } from "../lib/agent.ts";
import { capSpend, projectedUsd, readLedger, SpendCapReached } from "../lib/spend.ts";

const ledgerPath = () => join(mkdtempSync(join(tmpdir(), "spend-")), "ledger.json");
const request = { system: "s", user: "u" };
const costing = (costUsd: number | null): AskModel => async (_req, report) => {
  report?.({ model: "m", durationMs: 1, inputTokens: 10, outputTokens: 5, costUsd });
  return {};
};

describe("spend cap", () => {
  it("adds each call's cost to the ledger file", async () => {
    const path = ledgerPath();
    const ledger = readLedger(path, 1);
    const ask = capSpend(costing(0.25), path, ledger);
    await ask(request);
    await ask(request);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ spentUsd: 0.5, calls: 2 });
    expect(readLedger(path, 1).spentUsd).toBe(0.5);
  });

  it("refuses to call once the cap is reached", async () => {
    const path = ledgerPath();
    const ledger = readLedger(path, 0.5);
    let calls = 0;
    const ask = capSpend(async (r, rep) => {
      calls++;
      return costing(0.5)(r, rep);
    }, path, ledger);
    await ask(request);
    await expect(ask(request)).rejects.toBeInstanceOf(SpendCapReached);
    expect(calls).toBe(1);
  });

  it("counts a call with no price at the fallback, and an outage as nothing", async () => {
    const path = ledgerPath();
    const ledger = readLedger(path, 1);
    await capSpend(costing(null), path, ledger, 0.05)(request);
    const down: AskModel = async (_r, rep) => {
      rep?.({ model: "m", durationMs: 1, error: "down" });
      throw new Error("down");
    };
    await capSpend(down, path, ledger)(request).catch(() => {});
    expect(ledger).toMatchObject({ spentUsd: 0.05, calls: 1 });
  });

  it("projects from the ledger's average once it has one", () => {
    expect(projectedUsd({ capUsd: 1, spentUsd: 0, calls: 0 }, 10, 0.01)).toBeCloseTo(0.1);
    expect(projectedUsd({ capUsd: 1, spentUsd: 0.6, calls: 20 }, 10, 0.01)).toBeCloseTo(0.3);
  });
});
