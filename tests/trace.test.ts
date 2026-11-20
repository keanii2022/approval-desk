import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { AskModel } from "../lib/agent.ts";
import { claudeAgent } from "../lib/claude.ts";
import { openDatabase } from "../lib/db.ts";
import { type GateDecisionDetails, readEntries } from "../lib/logbook.ts";
import { processRequest } from "../lib/pipeline.ts";
import { seed } from "../lib/seed.ts";
import { standInAgent } from "../lib/stand-in-agent.ts";
import { type CallTrace, costUsd } from "../lib/trace.ts";

// Tracing: every Claude call leaves its tokens, cost, time and model on the
// gate's line. No real AI calls here: the real call runs against a faked fetch,
// and the other stand-ins report made-up token counts.

const NOW = "2026-10-05T12:00:00Z";

function freshDb(path = ":memory:"): DatabaseSync {
  const db = openDatabase(path);
  seed(db);
  return db;
}

const refundForm = (orderId: string, amountCents: number) => ({
  action: "refund",
  orderId,
  amountCents,
  reason: "Arrived damaged",
  policyLine: "P02",
});

const gateLine = (db: DatabaseSync, requestId: string) =>
  readEntries(db, requestId).find((line) => line.kind === "gate_decision")!.details as GateDecisionDetails;

// A stand-in that reports a trace the way the real call does, then answers or fails.
const traced =
  (form: unknown, trace: unknown): AskModel =>
  async (_request, reportTrace) => {
    reportTrace?.(trace as CallTrace);
    return form;
  };
const tracedOutage =
  (trace: CallTrace): AskModel =>
  async (_request, reportTrace) => {
    reportTrace?.(trace);
    throw new Error(trace.error);
  };

describe("the real call writes its trace on the gate line (fetch is faked)", () => {
  const askClaude = claudeAgent({ maxRetries: 0 });
  const originalKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  function fakeFetch(status: number, body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })),
    );
  }

  it("a successful call: tokens, cost, time and the model that answered, next to the gate's verdict", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    fakeFetch(200, {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5", // a fallback answered, not the model asked for
      content: [{ type: "text", text: JSON.stringify(refundForm("O1001", 2400)) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: null },
    });
    const db = freshDb();

    const result = await processRequest(db, "REQ-001", askClaude, NOW);

    expect(result.outcome).toBe("paid");
    const line = gateLine(db, "REQ-001");
    expect(line.decision.result).toBe("allow");
    expect(line.trace).toEqual({
      model: "claude-sonnet-5-5",
      durationMs: expect.any(Number),
      inputTokens: 1200,
      outputTokens: 80,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.0032,
    });
  });

  it("R6: an AI outage is written too: its time and error, no tokens, and a person decides", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    fakeFetch(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
    const db = freshDb();

    const result = await processRequest(db, "REQ-001", askClaude, NOW);

    expect(result).toMatchObject({ outcome: "waiting_for_human", rules: ["R6"] });
    const line = gateLine(db, "REQ-001");
    expect(line.output).toEqual({ status: "ai_down" });
    expect(line.trace).toEqual({ model: "claude-opus-5-5", durationMs: expect.any(Number), error: expect.any(String) });
  });
});

describe("no Claude call, no trace", () => {
  it("the stand-in agent writes no trace", async () => {
    const db = freshDb();
    await processRequest(db, "REQ-001", standInAgent, NOW);
    expect(gateLine(db, "REQ-001")).not.toHaveProperty("trace");
  });

  it("R7: a malformed trace is dropped, and the decision is still logged", async () => {
    const db = freshDb();
    const result = await processRequest(db, "REQ-001", traced(refundForm("O1001", 2400), { model: "x", durationMs: "slow" }), NOW);
    expect(result.outcome).toBe("paid");
    expect(gateLine(db, "REQ-001")).not.toHaveProperty("trace");
  });
});

describe("cost maths, per million tokens", () => {
  const tokens = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 400 };

  it("Opus 5.5: $4 in, $20 out, $0.20 cache reads, cache writes at 1.25x input", () => {
    expect(costUsd("claude-opus-5-5", tokens)).toBe(0.0164);
    expect(costUsd("claude-opus-5-5", { ...tokens, inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(24);
  });

  it("Sonnet 5.5: $2 in, $10 out, $0.10 cache reads", () => {
    expect(costUsd("claude-sonnet-5-5", tokens)).toBe(0.0082);
  });

  it("Haiku 5.5: $0.10 in, $0.50 out, for prompts up to 100K tokens", () => {
    const plain = { inputTokens: 3000, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(costUsd("claude-haiku-5-5", plain)).toBe(0.0005);
    expect(costUsd("claude-haiku-5-5", { ...plain, inputTokens: 100_000, outputTokens: 0 })).toBe(0.01);
    expect(costUsd("claude-haiku-5-5", { ...plain, inputTokens: 100_001 })).toBeNull(); // no listed price
    expect(costUsd("claude-haiku-5-5", { ...plain, cacheReadTokens: 10 })).toBeNull(); // no listed cache price
  });

  it("an unknown model gets no cost, never a guess", () => {
    expect(costUsd("claude-mystery-9", tokens)).toBeNull();
  });
});

describe("npm run trace on a seeded database", () => {
  const dir = mkdtempSync(join(tmpdir(), "approval-desk-trace-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const trace = (model: string, durationMs: number, inputTokens: number, outputTokens: number): CallTrace => {
    const counts = { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 };
    return { model, durationMs, ...counts, costUsd: costUsd(model, counts) };
  };

  it("its totals match the traced lines", async () => {
    const path = join(dir, "traced.db");
    const db = freshDb(path);
    await processRequest(db, "REQ-001", traced(refundForm("O1001", 2400), trace("claude-opus-5-5", 1200, 1500, 90)), NOW);
    await processRequest(db, "REQ-002", traced(refundForm("O1002", 15000), trace("claude-sonnet-5-5", 800, 1400, 70)), NOW);
    await processRequest(db, "REQ-003", traced("APPROVED", trace("claude-mystery-9", 500, 1000, 5)), NOW);
    await processRequest(db, "REQ-004", tracedOutage({ model: "claude-opus-5-5", durationMs: 300, error: "Overloaded" }), NOW);
    await processRequest(db, "REQ-005", standInAgent, NOW); // no Claude call: not counted

    const traces = readEntries(db)
      .filter((line) => line.kind === "gate_decision")
      .map((line) => (line.details as GateDecisionDetails).trace)
      .filter((t): t is CallTrace => t !== undefined);
    db.close();

    const sum = (pick: (t: CallTrace) => number | null | undefined) => traces.reduce((n, t) => n + (pick(t) ?? 0), 0);
    const out = execFileSync("node", ["scripts/trace.ts", path], { encoding: "utf8" });

    expect(traces).toHaveLength(4);
    expect(out).toContain("Calls: 4");
    expect(out).toContain(`Tokens: ${sum((t) => t.inputTokens).toLocaleString("en-US")} in, ${sum((t) => t.outputTokens)} out`);
    expect(out).toContain(`Total cost: $${sum((t) => t.costUsd).toFixed(6)} (not counting 1 unpriced call)`);
    expect(out).toContain(`Average time: ${Math.round(sum((t) => t.durationMs) / 4)} ms`);
    expect(out).toContain("  allow: 1\n  send to a person: 1\n  block: 1\n  AI down: 1");
  });
});
