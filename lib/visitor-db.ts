import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./db.ts";
import { readVisitorId } from "./visitor.ts";

// Every visitor gets their own copy of the shop, made from the template database (the
// seeded shop plus the overnight requests). What one visitor approves or pays never
// shows up for another. Visitors never write to the template.
//
// For a template at data/approval-desk.db:
//   data/approval-desk-visitors/<visitorId>.db   one copy per visitor
//   data/approval-desk-limits.db                 the site-wide try counts, shared by every copy
// The folder and the counts file are named after the template, so the browser tests'
// template (data/e2e.db) never shares copies or counts with the real one.

export const MAX_COPIES = 200;
export const COPY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const COPY_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.db$/;

const templateStem = (templatePath: string) => join(dirname(templatePath), basename(templatePath, extname(templatePath)));

export function visitorFolder(templatePath: string): string {
  return `${templateStem(templatePath)}-visitors`;
}

export function countsPath(templatePath: string): string {
  return `${templateStem(templatePath)}-limits.db`;
}

export function visitorCopyPath(templatePath: string, visitorId: string): string {
  const id = readVisitorId(visitorId);
  if (id === null) throw new Error("Not a visitor ID this app made");
  return join(visitorFolder(templatePath), `${id}.db`);
}

function requireTemplate(templatePath: string): void {
  if (!existsSync(templatePath)) throw new Error(`There is no database at ${templatePath}`);
}

// What a page shows before the visitor has a cookie: the template, which can't be written through this connection.
export function openTemplateReadOnly(templatePath: string): DatabaseSync {
  requireTemplate(templatePath);
  return new DatabaseSync(templatePath, { readOnly: true });
}

// The visitor's own shop, made from the template the first time they read or write.
export function openVisitorDb(templatePath: string, visitorId: string, now = Date.now()): DatabaseSync {
  const copy = visitorCopyPath(templatePath, visitorId);
  if (!existsSync(copy)) {
    requireTemplate(templatePath);
    makeCopy(templatePath, copy);
    removeOldCopies(visitorFolder(templatePath), now);
  }
  // Every use counts as a touch, so the 7-day cleanup only removes copies no one has opened.
  const time = new Date(now);
  utimesSync(copy, time, time);
  return openDatabase(copy);
}

function makeCopy(templatePath: string, copy: string): void {
  mkdirSync(dirname(copy), { recursive: true });
  // A read transaction holds SQLite's shared lock, so nothing can write the template while
  // it is copied. The copy goes to a temporary name first: two requests from the same new
  // visitor can't see a half-written file.
  const temporary = `${copy}.${process.pid}.${Date.now()}.tmp`;
  const template = new DatabaseSync(templatePath, { readOnly: true });
  try {
    template.exec("BEGIN");
    template.prepare("SELECT COUNT(*) FROM sqlite_master").get();
    copyFileSync(templatePath, temporary);
    template.exec("COMMIT");
  } finally {
    template.close();
  }
  renameSync(temporary, copy);
}

// Keeps the free host's disk from filling: removes copies untouched for 7 days, then the
// oldest ones until at most 200 are left.
export function removeOldCopies(folder: string, now = Date.now(), limits = { max: MAX_COPIES, maxAgeMs: COPY_MAX_AGE_MS }): void {
  if (!existsSync(folder)) return;
  const copies = readdirSync(folder)
    .filter((name) => COPY_FILE.test(name))
    .map((name) => ({ path: join(folder, name), touched: statSync(join(folder, name)).mtimeMs }))
    .sort((a, b) => b.touched - a.touched);
  copies.forEach((copy, index) => {
    if (index >= limits.max || now - copy.touched > limits.maxAgeMs) removeCopy(copy.path);
  });
}

function removeCopy(path: string): void {
  for (const file of [path, `${path}-journal`, `${path}-wal`, `${path}-shm`]) rmSync(file, { force: true });
}

// The one place every visitor's tries are counted for the spending limits.
export function openCounts(templatePath: string): DatabaseSync {
  const db = new DatabaseSync(countsPath(templatePath));
  db.exec("PRAGMA busy_timeout = 2000;"); // several visitors can try at once
  return db;
}
