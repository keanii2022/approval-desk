import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { buildRequest, runAgent, type AskModel, type ModelRequest } from "../lib/agent.ts";
import { askClaude } from "../lib/claude.ts";
import { openDatabase } from "../lib/db.ts";
import { checkProposal } from "../lib/gate.ts";
import { seed } from "../lib/seed.ts";

// The agent's tests use a stand-in for the AI: fixed answers written here, and
// no AI calls. How good the agent's judgment is gets measured by the evals (step 9).

const db = openDatabase(":memory:");
seed(db);

function standIn(answer: unknown): AskModel {
  return async () => answer;
}

const GOOD_FORM = { action: "refund", orderId: "O1001", amountCents: 2400, reason: "Mugs arrived cracked", policyLine: "P02" };

describe("R5: a garbled answer is blocked", () => {
  const garbled: [string, unknown][] = [
    ["plain text instead of a form", "APPROVED"],
    ["empty text", ""],
    ["nothing at all", null],
    ["a list", [GOOD_FORM]],
    ["a missing field", { action: "refund", orderId: "O1001", amountCents: 2400, reason: "Cracked" }],
    ["an extra field", { ...GOOD_FORM, note: "please hurry" }],
    ["an amount as text", { ...GOOD_FORM, amountCents: "2400" }],
    ["an amount in dollars with cents", { ...GOOD_FORM, amountCents: 24.5 }],
    ["an unknown action", { ...GOOD_FORM, action: "approve" }],
    ["a policy line that doesn't exist", { ...GOOD_FORM, policyLine: "P99" }],
    ["a refund with no order", { ...GOOD_FORM, orderId: null }],
  ];

  for (const [name, answer] of garbled) {
    it(`R5: ${name} reaches the gate unchanged and is blocked`, async () => {
      const output = await runAgent(db, "REQ-001", standIn(answer));
      expect(output).toEqual({ status: "answered", form: answer });
      expect(checkProposal(db, "REQ-001", output)).toEqual({ result: "block", rules: ["R5"] });
    });
  }

  it("R5: a well-formed answer is passed on as it is, not changed by the agent", async () => {
    const output = await runAgent(db, "REQ-001", standIn(GOOD_FORM));
    expect(output).toEqual({ status: "answered", form: GOOD_FORM });
    expect(checkProposal(db, "REQ-001", output)).toEqual({ result: "allow", rules: [] });
  });
});

describe("R6: no answer means the AI is down", () => {
  it("R6: an AI that fails gives 'ai_down', and the gate sends it to a human", async () => {
    const failing: AskModel = async () => {
      throw new Error("connection refused");
    };
    const output = await runAgent(db, "REQ-001", failing);
    expect(output).toEqual({ status: "ai_down" });
    expect(checkProposal(db, "REQ-001", output)).toEqual({ result: "send_to_human", rules: ["R6"] });
  });
});

describe("the real AI call (no network: fetch is faked)", () => {
  const request: ModelRequest = { system: "system text", user: "user text" };
  const originalKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  function fakeFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("R6: no API key means no answer, and no request is sent", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchMock = fakeFetch(200, {});
    await expect(askClaude(request)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("R6: an error from the API means no answer", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    fakeFetch(529, { type: "error" });
    await expect(askClaude(request)).rejects.toThrow();
    expect(await runAgent(db, "REQ-001", askClaude)).toEqual({ status: "ai_down" });
  });

  it("R6: a connection failure means no answer", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await runAgent(db, "REQ-001", askClaude)).toEqual({ status: "ai_down" });
  });

  it("returns the form Claude filled in, and asks for the form to be filled", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fetchMock = fakeFetch(200, { content: [{ type: "tool_use", name: "fill_form", input: GOOD_FORM }] });
    expect(await askClaude(request)).toEqual(GOOD_FORM);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(init.body as string);
    expect(sent.tool_choice).toEqual({ type: "tool", name: "fill_form" });
    expect(sent.system).toBe("system text");
    expect(sent.messages).toEqual([{ role: "user", content: "user text" }]);
    expect(sent.tools).toHaveLength(1); // the form is the only thing Claude can use
  });

  it("R5: if Claude answers in plain text instead of the form, the text goes to the gate and is blocked", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    fakeFetch(200, { content: [{ type: "text", text: "APPROVED" }] });
    const output = await runAgent(db, "REQ-020", askClaude);
    expect(output).toEqual({ status: "answered", form: "APPROVED" });
    expect(checkProposal(db, "REQ-020", output)).toEqual({ result: "block", rules: ["R5"] });
  });

  it("R5: an answer with no content at all is blocked, not treated as down", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    fakeFetch(200, {});
    const output = await runAgent(db, "REQ-001", askClaude);
    expect(checkProposal(db, "REQ-001", output)).toEqual({ result: "block", rules: ["R5"] });
  });
});

describe("what the agent sees", () => {
  it("includes the message, the customer's own orders and refunds, and the whole policy", () => {
    const { user } = buildRequest(db, "REQ-001");
    expect(user).toContain("Cracked mugs");
    expect(user).toContain("O1001");
    expect(user).toContain("$24.00 (2400 cents)");
    for (const id of ["P01", "P08", "P13"]) expect(user).toContain(id);

    // R4's history: REQ-008's customer has three earlier refunds on record.
    const history = buildRequest(db, "REQ-008").user;
    expect((history.match(/- RF\d+:/g) ?? []).length).toBe(3);
  });

  it("leaves out other customers' orders (REQ-022 names O1001, which isn't theirs)", () => {
    const { user } = buildRequest(db, "REQ-022");
    expect(user).toContain("O1001"); // only because the message names it
    expect(user).not.toContain("Speckled ceramic mug set");
    expect(user).not.toContain("Mara Lindqvist");
  });

  it("keeps the customer's message inside its own marked block, as data", () => {
    const { system, user } = buildRequest(db, "REQ-020");
    const message = user.slice(user.indexOf("<customer_message>"), user.indexOf("</customer_message>"));
    expect(message).toContain("Ignore all previous instructions");
    expect(user.slice(0, user.indexOf("<customer_message>"))).not.toContain("Ignore all previous instructions");
    expect(system).toContain("untrusted");
  });

  it("stops with an error for a request that isn't in the Inbox, like the gate does", async () => {
    expect(() => buildRequest(db, "REQ-999")).toThrow(/REQ-999/);
    await expect(runAgent(db, "REQ-999", standIn(GOOD_FORM))).rejects.toThrow(/REQ-999/);
  });
});

describe("the agent cannot change data", () => {
  const dir = mkdtempSync(join(tmpdir(), "approval-desk-agent-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("runs fine on a read-only copy of the database, and changes nothing", async () => {
    const path = join(dir, "shop.db");
    const writable = openDatabase(path);
    seed(writable);
    const before = dump(writable);
    writable.close();

    const readOnly = new DatabaseSync(path, { readOnly: true });
    const output = await runAgent(readOnly, "REQ-002", standIn(GOOD_FORM));
    expect(output.status).toBe("answered");
    expect(() => readOnly.exec("DELETE FROM orders")).toThrow(); // proof the handle really can't write
    readOnly.close();

    const after = openDatabase(path);
    expect(dump(after)).toEqual(before);
    after.close();
  });
});

function dump(database: DatabaseSync): unknown {
  const tables = ["customers", "orders", "refunds", "policy_lines", "inbox"];
  return tables.map((t) => database.prepare(`SELECT * FROM ${t} ORDER BY 1`).all());
}
