// Runs every practice case through the real agent and the gate, and saves a
// dated scorecard in evals/. Nothing is paid or logged. Costs real API money:
// about 2 cents an answer, so a full run (60 cases x 3) is around $4.
// Needs ANTHROPIC_API_KEY in .env.
// Usage: npm run evals                          (the original 60, 3 runs each)
//        npm run evals -- --set hard            (the hard set written by another AI)
//        npm run evals -- --runs 1 CASE-001     (just the ones you name)
import { mkdirSync, writeFileSync } from "node:fs";
import { practiceCases } from "../data/cases.ts";
import { hardCases } from "../data/hard-cases.ts";
import { agentModel, askClaude } from "../lib/claude.ts";
import { runEvals, scorecardMarkdown } from "../lib/evals.ts";

const SETS = { practice: practiceCases, hard: hardCases };

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const runs = Number(option("--runs") ?? 3);
const set = (option("--set") ?? "practice") as keyof typeof SETS;
const all = SETS[set];
if (!all) throw new Error(`No set called ${set}. Sets: ${Object.keys(SETS).join(", ")}`);
const named = args.filter((a) => /^(CASE|HARD)-\d+$/.test(a));
const cases = named.length > 0 ? all.filter((c) => named.includes(c.id)) : all;
if (!Number.isInteger(runs) || runs < 1 || cases.length === 0) throw new Error("Nothing to run: check --runs and the case IDs");

const card = await runEvals(askClaude, {
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

const stem = `evals/${card.ranAt.replace(/:/g, "-")}${set === "practice" ? "" : `-${set}`}${cases.length < all.length ? "-partial" : ""}`;
mkdirSync("evals", { recursive: true });
writeFileSync(`${stem}.md`, scorecardMarkdown(card));
writeFileSync(`${stem}.json`, JSON.stringify(card, null, 2) + "\n");

console.log(`\nAccuracy ${(card.accuracy * 100).toFixed(1)}%  |  wrong decisions that got through: ${card.gotThrough.length}`);
console.log(`Saved ${stem}.md and ${stem}.json`);
