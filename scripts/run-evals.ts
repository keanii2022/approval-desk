// Runs every practice case through the real agent and the gate, and saves a
// dated scorecard in evals/. Nothing is paid or logged. Costs real API money:
// about 2 cents an answer, so a full run (60 cases x 3) is around $4.
// Needs ANTHROPIC_API_KEY in .env.
// Usage: npm run evals                          (the original 60, 3 runs each)
//        npm run evals -- --set hard            (the hard set written by another AI)
//        npm run evals -- --set holes           (follow-up requests, repeats, flagged and new accounts)
//        npm run evals -- --set hard2           (60 more written by Gemini after R9 to R11)
//        npm run evals -- --set edges           (every rule's exact boundary, one case each side)
//        npm run evals -- --runs 1 CASE-001     (just the ones you name)
import { mkdirSync, writeFileSync } from "node:fs";
import { type PracticeCase, practiceCases } from "../data/cases.ts";
import { hardCases } from "../data/hard-cases.ts";
import { hard2Cases } from "../data/hard2-cases.ts";
import { edgeCases } from "../data/edge-cases.ts";
import { holeCases } from "../data/hole-cases.ts";
import { agentModel, askClaude } from "../lib/claude.ts";
import { runEvals, scorecardMarkdown } from "../lib/evals.ts";
import { promptVersion } from "../lib/prompt.ts";
import { capSpend, projectedUsd, readLedger } from "../lib/spend.ts";

const SETS = { practice: practiceCases, hard: hardCases, hard2: hard2Cases as PracticeCase[], holes: holeCases, edges: edgeCases };

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const runs = Number(option("--runs") ?? 3);
const set = (option("--set") ?? "practice") as keyof typeof SETS;
const all = SETS[set];
if (!all) throw new Error(`No set called ${set}. Sets: ${Object.keys(SETS).join(", ")}`);
const named = args.filter((a) => /^(CASE|HARD2?|HOLE|EDGE)-\d+$/.test(a));
const cases = named.length > 0 ? all.filter((c) => named.includes(c.id)) : all;
if (!Number.isInteger(runs) || runs < 1 || cases.length === 0) throw new Error("Nothing to run: check --runs and the case IDs");

// Spend cap (lib/spend.ts): SPEND_CAP_USD, default $22, counted across every run in
// data/spend-ledger.json. A run that would likely pass the cap doesn't start.
const LEDGER = process.env.SPEND_LEDGER || "data/spend-ledger.json";
const ledger = readLedger(LEDGER, Number(process.env.SPEND_CAP_USD ?? 22));
const guessPerCall = agentModel().includes("haiku") ? 0.002 : 0.015;
const likely = projectedUsd(ledger, cases.length * runs, guessPerCall);
if (ledger.spentUsd + likely > ledger.capUsd) {
  throw new Error(`Not started: this run would likely cost $${likely.toFixed(2)}, and $${ledger.spentUsd.toFixed(2)} of the $${ledger.capUsd.toFixed(2)} cap is spent.`);
}
console.log(`Likely cost $${likely.toFixed(2)}; spent so far $${ledger.spentUsd.toFixed(2)} of $${ledger.capUsd.toFixed(2)}`);

const card = await runEvals(capSpend(askClaude, LEDGER, ledger), {
  model: agentModel(),
  set,
  runs,
  cases,
  onAnswer: (a, done, total) => {
    if (a.verdict !== "right" || done % 20 === 0 || done === total) {
      console.log(`${done}/${total}  ${a.caseId} run ${a.run}: ${a.verdict}${a.why ? ` (${a.why})` : ""}`);
    }
  },
});

if (ledger.spentUsd >= ledger.capUsd) {
  console.log(`Stopped at the spend cap ($${ledger.spentUsd.toFixed(2)}); the scorecard isn't saved because the last answers never reached the AI.`);
  process.exit(1);
}
card.prompt = promptVersion();
const stem = `evals/${card.ranAt.replace(/:/g, "-")}${set === "practice" ? "" : `-${set}`}${cases.length < all.length ? "-partial" : ""}`;
mkdirSync("evals", { recursive: true });
writeFileSync(`${stem}.md`, scorecardMarkdown(card));
writeFileSync(`${stem}.json`, JSON.stringify(card, null, 2) + "\n");

console.log(`\nAccuracy ${(card.accuracy * 100).toFixed(1)}%  |  wrong decisions that got through: ${card.gotThrough.length}`);
console.log(`Saved ${stem}.md and ${stem}.json  |  spent so far $${ledger.spentUsd.toFixed(2)} of $${ledger.capUsd.toFixed(2)}`);
