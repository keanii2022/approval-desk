import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AskModel } from "./agent.ts";

// A spending cap for eval runs. Every real call's cost (from its trace) is added
// to a ledger file that lasts across runs; once the total reaches the cap, no
// more calls go out. The API account itself has no spend limit, so this is the
// only brake. Costs are our own maths from token counts, so the cap is set a
// little under the real limit.

export type Ledger = { capUsd: number; spentUsd: number; calls: number };

export class SpendCapReached extends Error {
  constructor(ledger: Ledger) {
    super(`Spend cap reached: $${ledger.spentUsd.toFixed(2)} of $${ledger.capUsd.toFixed(2)}`);
  }
}

export function readLedger(path: string, capUsd: number): Ledger {
  const saved = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Ledger) : { spentUsd: 0, calls: 0 };
  return { capUsd, spentUsd: saved.spentUsd, calls: saved.calls };
}

const save = (path: string, ledger: Ledger) => writeFileSync(path, JSON.stringify(ledger, null, 2) + "\n");

// What a run of this many calls would likely cost: the ledger's own average per
// call, or the guess for this model if that's higher (a ledger full of cheap Haiku
// calls would otherwise make an Opus run look cheap).
export function projectedUsd(ledger: Ledger, calls: number, guessPerCall: number): number {
  const perCall = ledger.calls > 0 ? Math.max(ledger.spentUsd / ledger.calls, guessPerCall) : guessPerCall;
  return calls * perCall;
}

// Wraps the real call. Refuses before calling once the cap is reached; a call
// with no price (unknown model) counts at the dearest known price so it can't
// slip past.
export function capSpend(ask: AskModel, path: string, ledger: Ledger, fallbackCostUsd = 0.05): AskModel {
  // The file is re-read before every check and every add, so two runs going at once
  // share one total instead of overwriting each other's.
  const refresh = () => Object.assign(ledger, readLedger(path, ledger.capUsd));
  return async (request, reportTrace) => {
    if (refresh().spentUsd >= ledger.capUsd) throw new SpendCapReached(ledger);
    return ask(request, (trace) => {
      if (trace.inputTokens !== undefined) {
        refresh();
        ledger.spentUsd += trace.costUsd ?? fallbackCostUsd;
        ledger.calls += 1;
        save(path, ledger);
      }
      reportTrace?.(trace);
    });
  };
}
