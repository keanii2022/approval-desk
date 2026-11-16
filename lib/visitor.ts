import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

// Every visitor gets a private sandbox. A cookie holds a random visitor ID, and
// each tried request is owned by the visitor who typed it. Seeded REQ- requests
// belong to no one, so everyone sees them and local demos keep working.
//
// Ownership lives in its own table (created here if missing) so the seed schema
// stays as it is. Each row also records the real UTC time of the try: the inbox
// date is the invented shop's calendar, which can't be used for spending limits.

export const VISITOR_COOKIE = "visitor";
export const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function newVisitorId(): string {
  return randomUUID();
}

// A cookie value is only trusted if it looks like an ID this app made.
export function readVisitorId(value: string | undefined): string | null {
  return value !== undefined && UUID.test(value) ? value : null;
}

export function ensureVisitorTable(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS try_owners (
    request_id TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    tried_at TEXT NOT NULL
  )`);
}

export function recordTry(db: DatabaseSync, requestId: string, visitorId: string, triedAt: string): void {
  ensureVisitorTable(db);
  db.prepare("INSERT INTO try_owners (request_id, visitor_id, tried_at) VALUES (?, ?, ?)").run(requestId, visitorId, triedAt);
}

// Tried requests start with TRY-. Anything else is the shop's own and everyone sees it.
// A tried request with no owner on record is no one's, so no one sees it.
export function canSeeRequest(db: DatabaseSync, requestId: string, visitorId: string | null): boolean {
  if (!requestId.startsWith("TRY-")) return true;
  if (visitorId === null) return false;
  ensureVisitorTable(db);
  return Boolean(db.prepare("SELECT 1 FROM try_owners WHERE request_id = ? AND visitor_id = ?").get(requestId, visitorId));
}

export type TryLimits = { enabled?: boolean; daily: number; visitorHourly: number };

function limitFromEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isSafeInteger(n) && n >= 0 ? n : fallback;
}

export function tryLimits(env: Record<string, string | undefined> = process.env): TryLimits {
  return {
    // TRY_ENABLED=off is the owner's off switch for the live agent, no redeploy of code needed.
    enabled: (env.TRY_ENABLED ?? "").trim().toLowerCase() !== "off",
    daily: limitFromEnv(env.TRY_DAILY_LIMIT, 20),
    visitorHourly: limitFromEnv(env.TRY_VISITOR_HOURLY_LIMIT, 5),
  };
}

export const SWITCHED_OFF_WORDS = "The live agent is switched off right now. The stories in the village still play.";
export const DAILY_LIMIT_WORDS = "The agent is done for today, come back tomorrow.";
export const HOURLY_LIMIT_WORDS = "That's all your tries for this hour. Come back in a bit.";

// Says in plain words why one more try isn't allowed right now, or null if it is.
// "A day" is the UTC calendar day; "an hour" is the last 60 minutes.
export function spendingProblem(db: DatabaseSync, visitorId: string, now: string, limits: TryLimits = tryLimits()): string | null {
  if (limits.enabled === false) return SWITCHED_OFF_WORDS;
  ensureVisitorTable(db);
  const today = now.slice(0, 10);
  const { n: triedToday } = db.prepare("SELECT COUNT(*) AS n FROM try_owners WHERE substr(tried_at, 1, 10) = ?").get(today) as { n: number };
  if (triedToday >= limits.daily) return DAILY_LIMIT_WORDS;

  const hourAgo = new Date(Date.parse(now) - 60 * 60 * 1000).toISOString().slice(0, 19) + "Z";
  const { n: triedThisHour } = db
    .prepare("SELECT COUNT(*) AS n FROM try_owners WHERE visitor_id = ? AND tried_at > ?")
    .get(visitorId, hourAgo) as { n: number };
  if (triedThisHour >= limits.visitorHourly) return HOURLY_LIMIT_WORDS;
  return null;
}
