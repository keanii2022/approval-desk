// The weekly drift check (lib/drift.ts): every 8th case of every set, once each, on the
// real agent, compared with the last full scorecard of that set on the same model and
// prompt. Saves evals/drift/<date>.md and exits 1 if anything drifted, so a scheduled
// run shows red. About 40 calls, roughly 50 cents on Opus; the spend cap applies.
// Usage: npm run drift
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SETS } from "../data/sets.ts";
import { agentModel, askClaude } from "../lib/claude.ts";
import { compareDrift, driftMarkdown, driftSample } from "../lib/drift.ts";
import { runEvals, type Scorecard } from "../lib/evals.ts";
import { promptVersion } from "../lib/prompt.ts";
import { capSpend, projectedUsd, readLedger } from "../lib/spend.ts";

const model = agentModel();
const prompt = promptVersion();

// The newest full run of each set on this model and prompt that kept every decision.
const baselines = new Map<string, Scorecard>();
for (const f of readdirSync("evals").filter((f) => f.endsWith(".json") && !f.includes("-partial")).sort()) {
  const card = JSON.parse(readFileSync(join("evals", f), "utf8")) as Scorecard;
  if (card.model === model && card.prompt === prompt && card.decisions) baselines.set(card.set, card);
}

const samples = Object.entries(SETS).map(([set, cases]) => ({ set, cases: driftSample(cases) }));
const calls = samples.reduce((n, s) => n + s.cases.length, 0);
const ledgerPath = process.env.SPEND_LEDGER || "data/spend-ledger.json";
const ledger = readLedger(ledgerPath, Number(process.env.SPEND_CAP_USD ?? 22));
const likely = projectedUsd(ledger, calls, model.includes("haiku") ? 0.002 : 0.015);
if (ledger.spentUsd + likely > ledger.capUsd) throw new Error(`Not started: likely $${likely.toFixed(2)}, and $${ledger.spentUsd.toFixed(2)} of the $${ledger.capUsd.toFixed(2)} cap is spent.`);

const ask = capSpend(askClaude, ledgerPath, ledger);
const cards: Scorecard[] = [];
for (const { set, cases } of samples) cards.push(await runEvals(ask, { model, set, runs: 1, cases }));
if (ledger.spentUsd >= ledger.capUsd) {
  console.log("Stopped at the spend cap; no drift report saved.");
  process.exit(1);
}

const ranAt = new Date().toISOString().slice(0, 19) + "Z";
const result = compareDrift(cards, baselines);
const folder = join("evals", "drift");
if (!existsSync(folder)) mkdirSync(folder, { recursive: true });
const file = join(folder, `${ranAt.slice(0, 10)}.md`);
writeFileSync(file, driftMarkdown(ranAt, model, prompt, result));
console.log(result.alerts.length === 0 ? "No drift." : `Drift:\n${result.alerts.join("\n")}`);
console.log(`Saved ${file}  |  ${calls} calls, spent so far $${ledger.spentUsd.toFixed(2)} of $${ledger.capUsd.toFixed(2)}`);
process.exit(result.alerts.length === 0 ? 0 : 1);
