import { cookies } from "next/headers";
import type { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "../../lib/db.ts";
import { newVisitorId, readVisitorId, VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE } from "../../lib/visitor.ts";
import { openCounts, openTemplateReadOnly, openVisitorDb } from "../../lib/visitor-db.ts";

// The template is the database file the scripts make (npm start: the seeded shop plus the
// overnight requests). The tests point at their own with APPROVAL_DESK_DB, so they never
// touch real data. Visitors read and write their own copy of it (lib/visitor-db.ts).
// A missing template is an error, not a new empty database.
const templatePath = () => process.env.APPROVAL_DESK_DB ?? DB_PATH;

// For pages: the visitor's own shop, or the template, read only, when they have no cookie yet.
export function pageDb(visitorId: string | null): DatabaseSync {
  return visitorId === null ? openTemplateReadOnly(templatePath()) : openVisitorDb(templatePath(), visitorId);
}

// For server actions: the visitor's own shop. Cookies can only be set in a server action, so a
// visitor without one gets their ID here, before anything is written.
export async function visitorShop(): Promise<{ db: DatabaseSync; visitorId: string }> {
  const visitorId = await ensureVisitorId();
  return { db: openVisitorDb(templatePath(), visitorId), visitorId };
}

// The site-wide try counts for the spending limits, shared by every visitor's copy.
export function countsDb(): DatabaseSync {
  return openCounts(templatePath());
}

async function ensureVisitorId(): Promise<string> {
  const store = await cookies();
  const existing = readVisitorId(store.get(VISITOR_COOKIE)?.value);
  if (existing) return existing;
  const id = newVisitorId();
  store.set(VISITOR_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: VISITOR_COOKIE_MAX_AGE,
    path: "/",
  });
  return id;
}
