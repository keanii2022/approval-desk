// Runs every practice case through the real agent and the gate, and saves a
// dated scorecard in evals/. Nothing is paid or logged. Costs real API money:
// about 2 cents an answer, so a full run (60 cases x 3) is around $4.
// Needs ANTHROPIC_API_KEY in .env.
// Usage: npm run evals                          (all 60 cases, 3 runs each)
//        npm run evals -- --runs 1 CASE-001     (just the ones you name)
import { mkdirSync, writeFileSync } from "node:fs";
import { practiceCases } from "../data/cases.ts";
import { agentModel, askClaude } from "../lib/claude.ts";
import { runEvals, scorecardMarkdown } from "../lib/evals.ts";

const args = process.argv.slice(2);
const runsAt = args.indexOf("--runs");
const runs = runsAt === -1 ? 3 : Number(args[runsAt + 1]);
const named = args.filter((a, i) => a.startsWith("CASE-") && i !== runsAt + 1);
const cases = named.length > 0 ? practiceCases.filter((c) => named.includes(c.id)) : practiceCases;
if (!Number.isInteger(runs) || runs < 1 || cases.length === 0) throw new Error("Nothing to run: check --runs and the case IDs");

const card = await runEvals(askClaude, {
  model: agentModel(),
  runs,
  cases,
  onAnswer: (a, done, total) => {
    if (a.verdict !== "right" || done % 20 === 0 || done === total) {
      console.log(`${done}/${total}  ${a.caseId} run ${a.run}: ${a.verdict}${a.why ? ` (${a.why})` : ""}`);
    }
  },
});

const stem = `evals/${card.ranAt.replace(/:/g, "-")}${cases.length < practiceCases.length ? "-partial" : ""}`;
mkdirSync("evals", { recursive: true });
writeFileSync(`${stem}.md`, scorecardMarkdown(card));
writeFileSync(`${stem}.json`, JSON.stringify(card, null, 2) + "\n");

console.log(`\nAccuracy ${(card.accuracy * 100).toFixed(1)}%  |  wrong decisions that got through: ${card.gotThrough.length}`);
console.log(`Saved ${stem}.md and ${stem}.json`);
