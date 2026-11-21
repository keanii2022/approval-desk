import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { promptVersion } from "../lib/prompt.ts";

// Every prompt the agent runs on is scored first. EVALS.md names each version it
// scored, so changing the prompt or the policy without a new entry there fails here.

describe("prompt scores", () => {
  it("EVALS.md has an entry for the prompt the agent runs on now", () => {
    const log = readFileSync("EVALS.md", "utf8");
    expect(log, `no entry for prompt ${promptVersion()}: score it and add it to EVALS.md`).toContain(`prompt \`${promptVersion()}\``);
  });

  it("each scored change has a guess written next to its result", () => {
    const entries = readFileSync("EVALS.md", "utf8").split(/^## /m).slice(1);
    const changes = entries.filter((e) => e.startsWith("Change "));
    expect(changes.length).toBeGreaterThanOrEqual(2);
    for (const e of changes) {
      expect(e, e.split("\n")[0]).toMatch(/\*\*Guess, written before the run:\*\*/);
      expect(e, e.split("\n")[0]).toMatch(/\*\*Result:\*\*/);
    }
  });
});
