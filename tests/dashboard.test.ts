import { describe, expect, it } from "vitest";
import { deskLoad, type DeskDecision, type ScorecardRow } from "../lib/dashboard.ts";

// Step 31: how many answers reach a person, per rule, from fake scorecards. No disk, no AI.

const SHIPS = "abc123def456";

function card(set: string, ranAt: string, decisions: DeskDecision[] | null, prompt: string | null = SHIPS): ScorecardRow {
  return { file: `${ranAt}-${set}.md`, set, ranAt, model: "stand-in", accuracy: 0, answers: decisions?.length ?? 0, gotThrough: 0, prompt, decisions };
}

const allow = (verdict = "right"): DeskDecision => ({ verdict, result: "allow", rules: [] });
const person = (rules: string[], verdict = "right"): DeskDecision => ({ verdict, result: "send_to_human", rules });

describe("deskLoad", () => {
  it("R2, R6: counts answers sent to a person, per set and per rule", () => {
    const load = deskLoad(
      [card("practice", "2026-11-21T09:00:00Z", [allow(), allow(), person(["R2"]), person(["R6"], "caught_by_person")])],
      SHIPS,
    );
    expect(load.sets).toEqual([{ set: "practice", ranAt: "2026-11-21T09:00:00Z", answers: 4, toPerson: 2, perRule: { R2: 1, R6: 1 } }]);
    expect(load.rules).toEqual(["R2", "R6"]);
  });

  it("R9, R10: an answer sent for two rules counts once in the total and once for each rule", () => {
    const load = deskLoad([card("hard", "2026-11-21T09:00:00Z", [person(["R9", "R10"])])], SHIPS);
    expect(load.sets[0].toPerson).toBe(1);
    expect(load.sets[0].perRule).toEqual({ R9: 1, R10: 1 });
    expect(load.atDesk).toBe(1);
  });

  it("uses only the newest full scorecard of each set on the prompt that ships", () => {
    const load = deskLoad(
      [
        card("practice", "2026-11-21T10:00:00Z", [person(["R2"])], "oldprompt"),
        card("practice (some cases)", "2026-11-21T11:00:00Z", [person(["R3"])]),
        card("practice", "2026-11-21T09:00:00Z", [person(["R4"])]),
        card("practice", "2026-11-21T08:00:00Z", [person(["R5"])]),
      ],
      SHIPS,
    );
    expect(load.sets.map((s) => s.ranAt)).toEqual(["2026-11-21T09:00:00Z"]);
    expect(load.rules).toEqual(["R4"]);
  });

  it("skips scorecards from before every answer was kept, so the table can say it isn't recorded yet", () => {
    const load = deskLoad([card("practice", "2026-11-20T09:00:00Z", null)], SHIPS);
    expect(load.sets).toEqual([]);
    expect(load.atDesk).toBe(0);
  });

  it("R13, R14: rule IDs the dashboard doesn't know yet still show, in number order", () => {
    const load = deskLoad([card("edges", "2026-11-21T09:00:00Z", [person(["R14"]), person(["R13"]), person(["R2"])])], SHIPS);
    expect(load.rules).toEqual(["R2", "R13", "R14"]);
  });

  it("a tired reviewer: splits the desk into right answers that only needed a look and wrong forms a person had to catch", () => {
    const load = deskLoad(
      [
        card("practice", "2026-11-21T09:00:00Z", [person(["R2"]), person(["R6"], "caught_by_person"), allow("wrong_paid")]),
        card("hard", "2026-11-21T09:00:00Z", [person(["R3"]), person(["R6"], "ai_down")]),
      ],
      SHIPS,
    );
    expect(load).toMatchObject({ atDesk: 4, rightAtDesk: 2, wrongAtDesk: 2 });
  });
});
