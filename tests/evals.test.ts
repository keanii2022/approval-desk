import { describe, expect, it } from "vitest";
import { practiceCases } from "../data/cases.ts";
import { holeCases } from "../data/hole-cases.ts";
import type { AskModel, ModelRequest } from "../lib/agent.ts";
import { runEvals, scoreAnswer, scorecardMarkdown } from "../lib/evals.ts";

// The eval runner's own tests. A stand-in plays the agent: no AI calls. How good
// the real agent is shows up in the scorecards, not here.

const byId = (id: string) => practiceCases.find((c) => c.id === id)!;

// A stand-in that gives every case its expected answer, by reading the request ID
// out of the prompt the agent built.
const perfect: AskModel = async ({ user }: ModelRequest) => {
  const id = /Request (CASE-\d+)/.exec(user)![1];
  const e = byId(id).expected;
  return { action: e.action, orderId: e.orderId, amountCents: e.amountCents, reason: "expected", policyLine: e.policyLine };
};

const NOW = () => "2026-11-15T12:00:00Z";

describe("scoring one answer", () => {
  const plain = byId("CASE-001"); // $24 refund on O1001, allowed
  const human = byId("CASE-002"); // $150 refund on O1002, sent to a person (R2)
  const answered = (form: unknown) => ({ status: "answered" as const, form });

  it("a refund must match action, order, amount and the gate's result", () => {
    const right = { action: "refund", orderId: "O1001", amountCents: 2400, reason: "x", policyLine: "P02" };
    expect(scoreAnswer(plain, answered(right), { result: "allow", rules: [] })).toEqual({ verdict: "right", why: null });
    const less = scoreAnswer(plain, answered({ ...right, amountCents: 1200 }), { result: "allow", rules: [] });
    expect(less.verdict).toBe("wrong_paid");
    expect(less.why).toMatch(/amount 1200/);
  });

  it("a wrong 'no refund' the gate allows counts as got through: a customer turned away unchecked", () => {
    const answer = scoreAnswer(plain, answered({ action: "no_refund", orderId: null, amountCents: null, reason: "x", policyLine: "P07" }), { result: "allow", rules: [] });
    expect(answer.verdict).toBe("wrong_refused");
  });

  it("R6: 'unsure' when a refund was right is a miss, but a person sees it first", () => {
    const answer = scoreAnswer(plain, answered({ action: "unsure", orderId: null, amountCents: null, reason: "x", policyLine: "P13" }), { result: "send_to_human", rules: ["R6"] });
    expect(answer.verdict).toBe("caught_by_person");
  });

  it("R5: a garbled answer is a miss the gate blocked", () => {
    expect(scoreAnswer(plain, answered("APPROVED"), { result: "block", rules: ["R5"] }).verdict).toBe("blocked");
  });

  it("R6: no answer at all is its own outcome", () => {
    expect(scoreAnswer(human, { status: "ai_down" }, { result: "send_to_human", rules: ["R6"] }).verdict).toBe("ai_down");
  });

  it("a no-refund answer is right on action and gate result; the order is only a hint", () => {
    const c = byId("CASE-053"); // expected no_refund on O1024
    const answer = scoreAnswer(c, answered({ action: "no_refund", orderId: null, amountCents: null, reason: "x", policyLine: "P07" }), { result: "allow", rules: [] });
    expect(answer.verdict).toBe("right");
  });
});

describe("a whole run", () => {
  it("an agent that gives every expected answer scores 100%, with nothing got through", async () => {
    const card = await runEvals(perfect, { model: "stand-in", now: NOW });
    expect(card.answers).toBe(180);
    expect(card.accuracy).toBe(1);
    expect(card.trickyAccuracy).toBe(1);
    expect(card.gotThrough).toEqual([]);
    expect(card.misses).toEqual([]);
    expect(card.ranAt).toBe(NOW());
  });

  it("an agent that always refunds the full order gets caught out, and the dangerous ones are listed", async () => {
    const greedy: AskModel = async (request) => {
      const form = (await perfect(request)) as Record<string, unknown>;
      return form.action === "refund" ? form : { ...form, action: "refund", orderId: "O1001", amountCents: 2400 };
    };
    const cases = [byId("CASE-001"), byId("CASE-053")]; // one right refund, one where the right answer is no refund
    const card = await runEvals(greedy, { model: "stand-in", cases, runs: 2, now: NOW });
    expect(card.answers).toBe(4);
    expect(card.accuracy).toBe(0.5);
    expect(card.misses.map((a) => a.caseId)).toEqual(["CASE-053", "CASE-053"]);
    expect(card.gotThrough.length + card.counts.blocked + card.counts.caught_by_person).toBe(2);
  });

  it("R6: an AI that's down every time scores 0, and every answer went to a person", async () => {
    const down: AskModel = async () => {
      throw new Error("down");
    };
    const card = await runEvals(down, { model: "stand-in", cases: practiceCases.slice(0, 5), runs: 1, now: NOW });
    expect(card.accuracy).toBe(0);
    expect(card.counts.ai_down).toBe(5);
    expect(card.gotThrough).toEqual([]);
  });

  it("finds cases that are right in some runs and wrong in others", async () => {
    let calls = 0;
    const flaky: AskModel = async (request) => (++calls % 2 === 0 ? "garbage" : perfect(request));
    const card = await runEvals(flaky, { model: "stand-in", cases: [byId("CASE-001")], runs: 2, concurrency: 1, now: NOW });
    expect(card.unsteady).toEqual([{ caseId: "CASE-001", rightRuns: 1 }]);
  });

  it("writes a dated scorecard with accuracy, misses and wrong decisions that got through", async () => {
    const card = await runEvals(perfect, { model: "stand-in", cases: practiceCases.slice(0, 3), runs: 1, now: NOW });
    const md = scorecardMarkdown(card);
    expect(md).toContain("# Scorecard 2026-11-15");
    expect(md).toContain("**Accuracy** | **100.0%**");
    expect(md).toContain("## Misses");
    expect(md).toContain("## Wrong decisions that got through");
  });
});

describe("hole cases: what already happened comes first", () => {
  it("the earlier requests run with fixed forms (no AI), so the agent is asked once and sees the earlier refund (HOLE-01)", async () => {
    const prompts: string[] = [];
    const recording: AskModel = async ({ user }: ModelRequest) => {
      prompts.push(user);
      return { action: "unsure", orderId: null, amountCents: null, reason: "x", policyLine: "P02" };
    };
    const card = await runEvals(recording, { model: "stand-in", set: "holes", runs: 2, cases: holeCases.filter((c) => c.id === "HOLE-01"), now: NOW });

    expect(card.answers).toBe(2);
    expect(prompts).toHaveLength(2);
    // Each run gets its own shop, so the $75 was paid once in each, not twice in one.
    for (const p of prompts) expect(p.match(/Broken lamp/g)).toHaveLength(1);
  });
});
