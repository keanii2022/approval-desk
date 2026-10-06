import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../lib/db.ts";
import { seed } from "../lib/seed.ts";

// Reads the hard rules table from docs/RULES.md. Its rows have five columns
// (ID, rule, result, applies to, checked by), which tells them apart from the other tables.
function hardRules(): { id: string; text: string }[] {
  return readFileSync("docs/RULES.md", "utf8")
    .split("\n")
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length === 7 && /^R\d+$/.test(cells[1]))
    .map((cells) => ({ id: cells[1], text: cells[2] }));
}

const db = openDatabase(":memory:");
seed(db);

describe("refund policy", () => {
  it("docs/RULES.md lists R1 to R7", () => {
    expect(hardRules().map((rule) => rule.id)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6", "R7"]);
  });

  for (const rule of hardRules()) {
    it(`${rule.id}: appears in the policy, word for word`, () => {
      const lines = db.prepare("SELECT text FROM policy_lines WHERE rule_id = ?").all(rule.id) as { text: string }[];

      expect(lines).toHaveLength(1);
      expect(lines[0].text.startsWith(rule.text)).toBe(true);
    });
  }
});
