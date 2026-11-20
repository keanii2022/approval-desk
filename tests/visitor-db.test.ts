import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AskModel } from "../lib/agent.ts";
import { approveAndPay, getWaitingCases } from "../lib/approval.ts";
import { openDatabase } from "../lib/db.ts";
import { queueOvernight } from "../lib/overnight.ts";
import { seed } from "../lib/seed.ts";
import { recentTries, tryRequest } from "../lib/tryout.ts";
import { DAILY_LIMIT_WORDS, newVisitorId, spendingProblem, triesLeft } from "../lib/visitor.ts";
import {
  COPY_MAX_AGE_MS,
  MAX_COPIES,
  openCounts,
  openTemplateReadOnly,
  openVisitorDb,
  visitorCopyPath,
  visitorFolder,
} from "../lib/visitor-db.ts";

// Every visitor gets their own copy of the shop, made from the template (the seeded shop
// plus the overnight requests). The spending limits stay site-wide. No AI calls.

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-16T12:00:00Z");
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

let folder: string;
let template: string;

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), "approval-desk-visitors-"));
  template = join(folder, "shop.db");
  const db = openDatabase(template);
  seed(db);
  await queueOvernight(db);
  db.close();
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function use<T>(db: DatabaseSync, run: (db: DatabaseSync) => T): T {
  try {
    return run(db);
  } finally {
    db.close();
  }
}

const refundsOn = (db: DatabaseSync, orderId: string) => db.prepare("SELECT COUNT(*) AS n FROM refunds WHERE order_id = ?").get(orderId) as { n: number };

function approveReq002(db: DatabaseSync, visitorId: string) {
  const req002 = getWaitingCases(db, visitorId).find((c) => c.requestId === "REQ-002");
  if (!req002) throw new Error("REQ-002 isn't waiting");
  return approveAndPay(db, req002.gateEntryId, { orderId: "O1002", amount: "150.00" }, "2026-11-16T12:00:00Z", visitorId);
}

// C001 owns O1001 ($24.00 mugs); see data/shop.ts.
const SMALL = { action: "refund", orderId: "O1001", amountCents: 2400, reason: "Mugs arrived cracked", policyLine: "P02" };
const ask: AskModel = async () => SMALL;
const request = { customerId: "C001", subject: "", message: "Refund please" };

describe("a shop for each visitor", () => {
  it("R2: visitor A approves REQ-002 (over $100, sent to a human); visitor B still sees it waiting, with the order untouched", () => {
    const before = use(openVisitorDb(template, B, NOW), (db) => refundsOn(db, "O1002").n);

    const decision = use(openVisitorDb(template, A, NOW), (db) => approveReq002(db, A));
    expect(decision).toMatchObject({ ok: true, outcome: "paid" });
    use(openVisitorDb(template, A, NOW), (db) => {
      expect(getWaitingCases(db, A).map((c) => c.requestId)).not.toContain("REQ-002");
      expect(refundsOn(db, "O1002").n).toBe(before + 1);
    });

    use(openVisitorDb(template, B, NOW), (db) => {
      expect(getWaitingCases(db, B).map((c) => c.requestId)).toContain("REQ-002");
      expect(refundsOn(db, "O1002").n).toBe(before);
    });
  });

  it("tries by two visitors both count toward the one daily limit, and each copy numbers its own tries", async () => {
    const limits = { daily: 2, visitorHourly: 100 };
    const counts = openCounts(template);
    try {
      const mine = await use(openVisitorDb(template, A, NOW), (db) =>
        tryRequest(db, request, ask, { visitorId: A, now: "2026-11-16T09:00:00Z", limits, counts }),
      );
      const theirs = await use(openVisitorDb(template, B, NOW), (db) =>
        tryRequest(db, request, ask, { visitorId: B, now: "2026-11-16T10:00:00Z", limits, counts }),
      );
      expect([mine.requestId, theirs.requestId]).toEqual(["TRY-001", "TRY-001"]);

      const third = newVisitorId();
      expect(spendingProblem(counts, third, "2026-11-16T11:00:00Z", limits)).toBe(DAILY_LIMIT_WORDS);
      expect(triesLeft(counts, null, "2026-11-16T11:00:00Z", limits)).toBe(0);
      await expect(
        use(openVisitorDb(template, third, NOW), (db) => tryRequest(db, request, ask, { visitorId: third, now: "2026-11-16T11:00:00Z", limits, counts })),
      ).rejects.toThrow(DAILY_LIMIT_WORDS);

      // A visitor's try shows up only in their own shop.
      use(openVisitorDb(template, A, NOW), (db) => expect(recentTries(db, A).map((t) => t.message)).toEqual(["Refund please"]));
      use(openVisitorDb(template, B, NOW), (db) => expect(recentTries(db, A)).toEqual([]));
    } finally {
      counts.close();
    }
  });

  it("the template is byte-for-byte unchanged after visitors view, try and approve", async () => {
    const original = readFileSync(template);
    use(openTemplateReadOnly(template), (db) => getWaitingCases(db, null)); // a page view with no cookie yet
    use(openVisitorDb(template, A, NOW), (db) => approveReq002(db, A));
    const counts = openCounts(template);
    try {
      await use(openVisitorDb(template, B, NOW), (db) => tryRequest(db, request, ask, { visitorId: B, now: "2026-11-16T09:00:00Z", counts }));
    } finally {
      counts.close();
    }
    expect(readFileSync(template).equals(original)).toBe(true);
  });

  it("a page view with no cookie reads the template and can't write to it", () => {
    use(openTemplateReadOnly(template), (db) => {
      expect(getWaitingCases(db, null).map((c) => c.requestId)).toContain("REQ-002");
      expect(() => db.exec("DELETE FROM refunds")).toThrow(/readonly/);
      expect(approveReq002(db, newVisitorId())).toMatchObject({ ok: false });
    });
  });

  it("a copy path is only ever built from a visitor ID this app made", () => {
    expect(() => visitorCopyPath(template, "../shop")).toThrow();
    expect(() => openVisitorDb(template, "../../etc/passwd")).toThrow();
    expect(visitorCopyPath(template, A)).toBe(join(visitorFolder(template), `${A}.db`));
  });

  it("a missing template is an error, not a new empty shop", () => {
    const missing = join(folder, "nothing-here.db");
    expect(() => openVisitorDb(missing, A)).toThrow(/no database/);
    expect(() => openTemplateReadOnly(missing)).toThrow(/no database/);
    expect(existsSync(missing)).toBe(false);
  });
});

describe("cleaning up old copies", () => {
  // Stand-in copies: empty files with the given age, oldest first.
  function oldCopies(ages: number[]): string[] {
    const copies = visitorFolder(template);
    use(openVisitorDb(template, A, NOW), () => undefined); // makes the folder
    return ages.map((age) => {
      const path = join(copies, `${newVisitorId()}.db`);
      writeFileSync(path, "");
      const time = new Date(NOW - age);
      utimesSync(path, time, time);
      return path;
    });
  }

  it(`keeps at most ${MAX_COPIES} copies, removing the oldest first when a new one is made`, () => {
    const ages = Array.from({ length: MAX_COPIES }, (_, i) => (MAX_COPIES - i) * 60_000); // A's own copy makes 201
    const [oldest, secondOldest, ...rest] = oldCopies(ages);
    use(openVisitorDb(template, B, NOW), () => undefined);

    const left = readdirSync(visitorFolder(template)).filter((name) => name.endsWith(".db"));
    expect(left).toHaveLength(MAX_COPIES);
    expect(existsSync(oldest)).toBe(false);
    expect(existsSync(secondOldest)).toBe(false);
    expect(rest.every((path) => existsSync(path))).toBe(true);
    expect(existsSync(visitorCopyPath(template, B))).toBe(true);
    expect(existsSync(visitorCopyPath(template, A))).toBe(true);
  });

  it("removes copies untouched for 7 days, and using a copy counts as a touch", () => {
    const [stale, recent] = oldCopies([COPY_MAX_AGE_MS + 60_000, COPY_MAX_AGE_MS - 60_000]);
    use(openVisitorDb(template, B, NOW), () => undefined);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(recent)).toBe(true);

    const comesBack = NOW + 6 * DAY;
    use(openVisitorDb(template, A, comesBack), () => undefined);
    expect(statSync(visitorCopyPath(template, A)).mtimeMs).toBe(comesBack);

    // Eight days on: A came back two days ago, so only their copy is kept.
    const third = newVisitorId();
    use(openVisitorDb(template, third, NOW + 8 * DAY), () => undefined);
    expect(existsSync(visitorCopyPath(template, A))).toBe(true);
    expect(existsSync(recent)).toBe(false);
    expect(existsSync(visitorCopyPath(template, B))).toBe(false);
    expect(existsSync(visitorCopyPath(template, third))).toBe(true);
  });
});
