import type { PracticeCase } from "../data/cases.ts";
import type { Scorecard } from "./evals.ts";

// Model drift: the same prompt can answer differently after a model update, the way
// R12's wording once did. A weekly sample of every set is run once and compared with the
// last full scorecard of that set on the same model and prompt.

// Every nth case of a set, so the sample is the same every week and spread across the set.
export function driftSample<T extends PracticeCase>(cases: T[], every = 8): T[] {
  return cases.filter((_, i) => i % every === 0);
}

export type DriftRow = { set: string; cases: number; baselineRight: number | null; nowRight: number; gotThrough: number };

// How far the sample's share right may fall below the baseline on the same cases before it
// counts as drift. One run of a handful of cases is noisy, so it's wide.
const DROP_ALERT = 0.15;

export function compareDrift(samples: Scorecard[], baselines: Map<string, Scorecard>): { rows: DriftRow[]; alerts: string[] } {
  const rows: DriftRow[] = [];
  const alerts: string[] = [];
  for (const sample of samples) {
    const ids = new Set((sample.decisions ?? []).map((d) => d.caseId));
    const base = baselines.get(sample.set);
    const baseOnSame = (base?.decisions ?? []).filter((d) => ids.has(d.caseId));
    const baselineRight = baseOnSame.length > 0 ? baseOnSame.filter((d) => d.verdict === "right").length / baseOnSame.length : null;
    const row = { set: sample.set, cases: ids.size, baselineRight, nowRight: sample.accuracy, gotThrough: sample.gotThrough.length };
    rows.push(row);
    if (row.gotThrough > 0) alerts.push(`${sample.set}: ${row.gotThrough} wrong decision(s) got through (${sample.gotThrough.map((a) => a.caseId).join(", ")})`);
    if (baselineRight !== null && baselineRight - row.nowRight > DROP_ALERT) {
      alerts.push(`${sample.set}: ${pct(row.nowRight)} right, down from ${pct(baselineRight)} on the same cases`);
    }
  }
  return { rows, alerts };
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

export function driftMarkdown(ranAt: string, model: string, prompt: string, result: { rows: DriftRow[]; alerts: string[] }): string {
  return [
    `# Drift check ${ranAt.slice(0, 10)}`,
    "",
    `Ran ${ranAt} on \`${model}\` with prompt \`${prompt}\`: a sample of every set, once each, against the last full run.`,
    "",
    result.alerts.length === 0 ? "**No drift.** Nothing got through, and no set fell more than 15 points." : `**Drift:**\n\n${result.alerts.map((a) => `- ${a}`).join("\n")}`,
    "",
    "| Set | Cases | Last full run | This week | Got through |",
    "|---|---|---|---|---|",
    ...result.rows.map((r) => `| ${r.set} | ${r.cases} | ${r.baselineRight === null ? "no baseline" : pct(r.baselineRight)} | ${pct(r.nowRight)} | ${r.gotThrough} |`),
    "",
  ].join("\n");
}
