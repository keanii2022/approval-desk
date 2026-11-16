import type { DatabaseSync } from "node:sqlite";
import { type PracticeCase, practiceCases } from "../data/cases.ts";
import { type AskModel, runAgent } from "./agent.ts";
import { type AgentOutput, checkProposal, type GateDecision } from "./gate.ts";
import { openDatabase } from "./db.ts";
import { seed } from "./seed.ts";

// The eval runner: every practice case, several times, through the agent and the
// gate (parts 3 and 4). Nothing is paid and nothing is logged: it reads a fresh
// in-memory copy of the shop, so every run sees the same data.

export type Verdict =
  | "right"
  | "wrong_paid" // a wrong refund the gate allowed: money out that shouldn't be
  | "wrong_refused" // a wrong "no refund" the gate allowed: a customer turned away with no person checking
  | "caught_by_person" // wrong, but the gate sent it to a person, who sees it before anything happens
  | "blocked" // wrong, and the gate blocked it
  | "ai_down"; // no answer at all; the gate sent it to a person

export type Answer = {
  caseId: string;
  tricky: boolean;
  run: number;
  output: AgentOutput;
  decision: GateDecision;
  verdict: Verdict;
  why: string | null; // what didn't match, in plain words; null when right
};

export type Scorecard = {
  set: string; // which practice set: "practice" (the original 60) or "hard"
  ranAt: string; // UTC, like 2026-11-15T23:10:04Z
  model: string;
  runsPerCase: number;
  cases: number;
  answers: number;
  right: number;
  accuracy: number; // 0 to 1
  plainAccuracy: number;
  trickyAccuracy: number;
  counts: Record<Verdict, number>;
  gotThrough: Answer[]; // wrong_paid and wrong_refused: the dangerous ones
  misses: Answer[]; // every wrong answer, got through or not
  unsteady: { caseId: string; rightRuns: number }[]; // cases right in some runs and wrong in others
};

// A fresh shop with the practice cases in its Inbox. Kept apart from the app's database.
export function practiceDb(cases: PracticeCase[] = practiceCases): DatabaseSync {
  const db = openDatabase(":memory:");
  seed(db);
  const insert = db.prepare("INSERT INTO inbox (id, customer_id, received_on, subject, body) VALUES (?, ?, ?, ?, ?)");
  for (const c of cases) insert.run(c.id, c.customerId, c.receivedOn, c.subject, c.body);
  return db;
}

type Form = { action?: unknown; orderId?: unknown; amountCents?: unknown };

// Scores one answer by the rules at the top of data/cases.ts:
//   refund    -> action, orderId, amountCents, and the gate's result
//   no_refund -> action and the gate's result
//   unsure    -> action and the gate's result
// "Unsure" when something else was right is a plain miss, with no half credit;
// it shows up as "caught by a person", which is the safe kind of wrong.
export function scoreAnswer(c: PracticeCase, output: AgentOutput, decision: GateDecision): { verdict: Verdict; why: string | null } {
  if (output.status === "ai_down") return { verdict: "ai_down", why: "No answer from the AI" };

  const form = (typeof output.form === "object" && output.form !== null ? output.form : {}) as Form;
  const problems: string[] = [];
  if (form.action !== c.expected.action) problems.push(`action ${String(form.action)}, expected ${c.expected.action}`);
  else if (c.expected.action === "refund") {
    if (form.orderId !== c.expected.orderId) problems.push(`order ${String(form.orderId)}, expected ${c.expected.orderId}`);
    if (form.amountCents !== c.expected.amountCents) {
      problems.push(`amount ${String(form.amountCents)} cents, expected ${c.expected.amountCents}`);
    }
  }
  if (decision.result !== c.expected.gate) problems.push(`gate ${decision.result}, expected ${c.expected.gate}`);

  if (problems.length === 0) return { verdict: "right", why: null };
  const why = problems.join("; ");
  if (decision.result === "block") return { verdict: "blocked", why };
  if (decision.result === "send_to_human") return { verdict: "caught_by_person", why };
  return { verdict: form.action === "refund" ? "wrong_paid" : "wrong_refused", why };
}

export type EvalOptions = {
  model: string;
  set?: string;
  runs?: number;
  cases?: PracticeCase[];
  concurrency?: number;
  now?: () => string;
  onAnswer?: (answer: Answer, done: number, total: number) => void;
};

export async function runEvals(askModel: AskModel, options: EvalOptions): Promise<Scorecard> {
  const { model, runs = 3, cases = practiceCases, concurrency = 4 } = options;
  const db = practiceDb(cases);
  const jobs = cases.flatMap((c) => Array.from({ length: runs }, (_, i) => ({ c, run: i + 1 })));
  const answers: Answer[] = [];

  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { c, run } = jobs[next++];
      const output = await runAgent(db, c.id, askModel);
      const decision = checkProposal(db, c.id, output);
      const answer = { caseId: c.id, tricky: c.tricky, run, output, decision, ...scoreAnswer(c, output, decision) };
      answers.push(answer);
      options.onAnswer?.(answer, answers.length, jobs.length);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  } finally {
    db.close();
  }

  const order = new Map(cases.map((c, i) => [c.id, i]));
  answers.sort((a, b) => (order.get(a.caseId)! - order.get(b.caseId)!) || a.run - b.run);
  const ranAt = options.now?.() ?? new Date().toISOString().slice(0, 19) + "Z";
  return summarize(answers, { set: options.set ?? "practice", model, runs, cases: cases.length, ranAt });
}

function summarize(answers: Answer[], meta: { set: string; model: string; runs: number; cases: number; ranAt: string }): Scorecard {
  const share = (list: Answer[]) => (list.length === 0 ? 0 : list.filter((a) => a.verdict === "right").length / list.length);
  const counts: Record<Verdict, number> = {
    right: 0, wrong_paid: 0, wrong_refused: 0, caught_by_person: 0, blocked: 0, ai_down: 0,
  };
  for (const a of answers) counts[a.verdict]++;

  const rightRuns = new Map<string, number>();
  for (const a of answers) rightRuns.set(a.caseId, (rightRuns.get(a.caseId) ?? 0) + (a.verdict === "right" ? 1 : 0));

  return {
    set: meta.set,
    ranAt: meta.ranAt,
    model: meta.model,
    runsPerCase: meta.runs,
    cases: meta.cases,
    answers: answers.length,
    right: counts.right,
    accuracy: share(answers),
    plainAccuracy: share(answers.filter((a) => !a.tricky)),
    trickyAccuracy: share(answers.filter((a) => a.tricky)),
    counts,
    gotThrough: answers.filter((a) => a.verdict === "wrong_paid" || a.verdict === "wrong_refused"),
    misses: answers.filter((a) => a.verdict !== "right"),
    unsteady: [...rightRuns]
      .filter(([, n]) => n > 0 && n < meta.runs)
      .map(([caseId, n]) => ({ caseId, rightRuns: n })),
  };
}

const percent = (x: number) => `${(x * 100).toFixed(1)}%`;

const VERDICT_WORDS: Record<Verdict, string> = {
  right: "Right",
  wrong_paid: "Wrong refund the gate allowed (money out)",
  wrong_refused: "Wrong \"no refund\" the gate allowed (customer turned away)",
  caught_by_person: "Wrong, but sent to a person first",
  blocked: "Wrong, and blocked by the gate",
  ai_down: "No answer from the AI (sent to a person)",
};

function formSummary(output: AgentOutput): string {
  if (output.status === "ai_down") return "no answer";
  const f = output.form as Form & { reason?: unknown };
  if (typeof f !== "object" || f === null) return `not a form: ${JSON.stringify(f)}`;
  const amount = typeof f.amountCents === "number" ? ` $${(f.amountCents / 100).toFixed(2)}` : "";
  return `${String(f.action)} ${f.orderId ?? ""}${amount}. "${String(f.reason ?? "")}"`.replace(/\s+/g, " ");
}

export function scorecardMarkdown(card: Scorecard): string {
  const lines = [
    `# Scorecard ${card.ranAt.slice(0, 10)}${card.set === "practice" ? "" : ` (${card.set} set)`}`,
    "",
    `Ran ${card.ranAt} on \`${card.model}\`: ${card.cases} ${card.set} cases, ${card.runsPerCase} runs each, ${card.answers} answers.`,
    "",
    "| | |",
    "|---|---|",
    `| **Accuracy** | **${percent(card.accuracy)}** (${card.right} of ${card.answers}) |`,
    `| Plain cases | ${percent(card.plainAccuracy)} |`,
    `| Tricky cases | ${percent(card.trickyAccuracy)} |`,
    `| **Wrong decisions that got through** | **${card.gotThrough.length}** |`,
    "",
    "## Every answer, by outcome",
    "",
    "| Outcome | Answers |",
    "|---|---|",
    ...(Object.keys(VERDICT_WORDS) as Verdict[]).map((v) => `| ${VERDICT_WORDS[v]} | ${card.counts[v]} |`),
    "",
    "## Wrong decisions that got through",
    "",
    "Wrong answers the gate still allowed. These are the dangerous ones.",
    "",
    ...(card.gotThrough.length === 0
      ? ["None."]
      : card.gotThrough.map((a) => `- **${a.caseId}** run ${a.run}: ${VERDICT_WORDS[a.verdict]}. ${a.why}. Agent said: ${formSummary(a.output)}`)),
    "",
    "## Misses",
    "",
    ...(card.misses.length === 0
      ? ["None."]
      : card.misses.map((a) => `- **${a.caseId}**${a.tricky ? " (tricky)" : ""} run ${a.run}: ${VERDICT_WORDS[a.verdict]}. ${a.why}. Agent said: ${formSummary(a.output)}`)),
    "",
    "## Unsteady cases",
    "",
    "Right in some runs and wrong in others.",
    "",
    ...(card.unsteady.length === 0
      ? ["None."]
      : card.unsteady.map((u) => `- ${u.caseId}: right ${u.rightRuns} of ${card.runsPerCase}`)),
    "",
  ];
  return lines.join("\n");
}
