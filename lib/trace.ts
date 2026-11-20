import type { DatabaseSync } from "node:sqlite";

// Tracing: what each Claude call cost and how long it took. The real call
// (lib/claude.ts) reports one trace per request, and the pipeline stores it on
// the gate's logbook line for that request. Stand-in agents report nothing, so
// they leave no trace.

// One Claude call. On a failure (AI down) there are no token counts, only the
// time and the error, and no cost. costUsd is null when there's no price for
// the call below.
export type CallTrace = {
  model: string; // the model that answered (response.model), or the one asked for when there was no answer
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number | null;
  error?: string;
};

export type TokenCounts = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

// US dollars per million tokens. maxPromptTokens: the price only holds for
// prompts up to that size. A missing figure (Haiku's cache reads) or a bigger
// prompt gets no cost rather than a guess.
type Price = { input: number; output: number; cacheRead?: number; maxPromptTokens?: number };

export const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, maxPromptTokens: 100_000 },
};

// Cache writes cost 1.25x the input price (Anthropic's documented rate for
// 5-minute cache writes). The agent sets no cache breakpoints, so this is
// normally zero.
const CACHE_WRITE_MULTIPLIER = 1.25;

// Cost in US dollars, rounded to 6 decimals, or null for a model with no price.
export function costUsd(model: string, tokens: TokenCounts): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const promptTokens = tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens;
  if (price.maxPromptTokens !== undefined && promptTokens > price.maxPromptTokens) return null;
  if (price.cacheRead === undefined && tokens.cacheReadTokens > 0) return null;

  const perMillion =
    tokens.inputTokens * price.input +
    tokens.outputTokens * price.output +
    tokens.cacheReadTokens * (price.cacheRead ?? 0) +
    tokens.cacheWriteTokens * price.input * CACHE_WRITE_MULTIPLIER;
  return Math.round(perMillion) / 1_000_000;
}

const TOKEN_FIELDS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"] as const;
const TRACE_FIELDS = new Set<string>(["model", "durationMs", "costUsd", "error", ...TOKEN_FIELDS]);

const isCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

// True only for a trace this module would write: known fields, counts as whole
// numbers, cost a number or null. The logbook uses it to drop anything else.
export function isCallTrace(value: unknown): value is CallTrace {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const trace = value as Record<string, unknown>;
  if (Object.keys(trace).some((key) => !TRACE_FIELDS.has(key))) return false;
  if (typeof trace.model !== "string" || trace.model === "") return false;
  if (typeof trace.durationMs !== "number" || !Number.isFinite(trace.durationMs) || trace.durationMs < 0) return false;
  if (TOKEN_FIELDS.some((field) => trace[field] !== undefined && !isCount(trace[field]))) return false;
  const cost = trace.costUsd;
  if (cost !== undefined && cost !== null && (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)) {
    return false;
  }
  return trace.error === undefined || typeof trace.error === "string";
}

export type Verdict = "allow" | "send_to_human" | "block" | "ai_down";
export const VERDICTS: Verdict[] = ["allow", "send_to_human", "block", "ai_down"];

export type TraceSummary = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number; // priced calls only
  unpricedCalls: number;
  averageMs: number;
  byVerdict: Record<Verdict, number>;
};

type TraceRow = { trace: string; status: string; result: Verdict };

function traceRows(db: DatabaseSync): TraceRow[] {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'logbook'").get()) return [];
  return db
    .prepare(
      `SELECT json_extract(details, '$.trace') AS trace,
              json_extract(details, '$.output.status') AS status,
              json_extract(details, '$.decision.result') AS result
       FROM logbook
       WHERE kind = 'gate_decision' AND json_extract(details, '$.trace') IS NOT NULL
       ORDER BY id`,
    )
    .all() as TraceRow[];
}

// Reads every gate line that carries a trace, across one or several databases
// (the shop and each visitor's copy). One with no logbook yet has no calls.
export function summarizeTraces(dbs: DatabaseSync | DatabaseSync[]): TraceSummary {
  const summary: TraceSummary = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    unpricedCalls: 0,
    averageMs: 0,
    byVerdict: { allow: 0, send_to_human: 0, block: 0, ai_down: 0 },
  };
  const rows = (Array.isArray(dbs) ? dbs : [dbs]).flatMap((db) => traceRows(db));

  let totalMs = 0;
  let costMillionths = 0; // summed in whole millionths so six-decimal costs add up exactly
  for (const row of rows) {
    const trace = JSON.parse(row.trace) as CallTrace;
    summary.calls += 1;
    for (const field of TOKEN_FIELDS) summary[field] += trace[field] ?? 0;
    totalMs += trace.durationMs;
    if (typeof trace.costUsd === "number") costMillionths += Math.round(trace.costUsd * 1_000_000);
    else if (trace.costUsd === null) summary.unpricedCalls += 1;
    summary.byVerdict[row.status === "ai_down" ? "ai_down" : row.result] += 1;
  }
  summary.costUsd = costMillionths / 1_000_000;
  summary.averageMs = summary.calls === 0 ? 0 : Math.round(totalMs / summary.calls);
  return summary;
}

const VERDICT_NAMES: Record<Verdict, string> = {
  allow: "allow",
  send_to_human: "send to a person",
  block: "block",
  ai_down: "AI down",
};

export function formatSummary(path: string, s: TraceSummary): string[] {
  const n = (value: number) => value.toLocaleString("en-US");
  const unpriced = s.unpricedCalls === 0 ? "" : ` (not counting ${n(s.unpricedCalls)} unpriced ${s.unpricedCalls === 1 ? "call" : "calls"})`;
  return [
    `Trace summary for ${path}`,
    `Calls: ${n(s.calls)}`,
    `Tokens: ${n(s.inputTokens)} in, ${n(s.outputTokens)} out, ${n(s.cacheReadTokens)} cache reads, ${n(s.cacheWriteTokens)} cache writes`,
    `Total cost: $${s.costUsd.toFixed(6)}${unpriced}`,
    `Average time: ${n(s.averageMs)} ms`,
    "By gate verdict:",
    ...VERDICTS.map((v) => `  ${VERDICT_NAMES[v]}: ${n(s.byVerdict[v])}`),
  ];
}
