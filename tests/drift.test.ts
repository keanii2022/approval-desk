import { describe, expect, it } from "vitest";
import { compareDrift, driftMarkdown, driftSample } from "../lib/drift.ts";
import type { Scorecard } from "../lib/evals.ts";

const card = (set: string, verdicts: string[], gotThrough: string[] = []): Scorecard =>
  ({
    set,
    accuracy: verdicts.filter((v) => v === "right").length / verdicts.length,
    gotThrough: gotThrough.map((caseId) => ({ caseId })),
    decisions: verdicts.map((verdict, i) => ({ caseId: `C-${i}`, run: 1, verdict, result: "allow", rules: [] })),
  }) as unknown as Scorecard;

describe("drift check", () => {
  it("samples every 8th case, the same ones every time", () => {
    const cases = Array.from({ length: 20 }, (_, i) => ({ id: `C-${i}` })) as never[];
    expect(driftSample(cases).map((c: { id: string }) => c.id)).toEqual(["C-0", "C-8", "C-16"]);
  });

  it("no drift when the sample matches its baseline", () => {
    const result = compareDrift([card("practice", ["right", "right"])], new Map([["practice", card("practice", ["right", "right"])]]));
    expect(result.alerts).toEqual([]);
    expect(driftMarkdown("2026-11-28T09:00:00Z", "m", "p", result)).toContain("No drift");
  });

  it("anything that got through is drift, baseline or not", () => {
    const result = compareDrift([card("stack", ["right", "wrong_paid"], ["STACK-01"])], new Map());
    expect(result.alerts[0]).toContain("STACK-01");
  });

  it("a drop of more than 15 points on the same cases is drift; a small one isn't", () => {
    const base = new Map([["hard", card("hard", ["right", "right", "right", "right", "right", "right", "right", "right"])]]);
    expect(compareDrift([card("hard", ["right", "right", "right", "right", "right", "right", "right", "caught_by_person"])], base).alerts).toEqual([]);
    expect(compareDrift([card("hard", ["right", "right", "right", "right", "right", "right", "caught_by_person", "caught_by_person"])], base).alerts).toHaveLength(1);
  });
});
