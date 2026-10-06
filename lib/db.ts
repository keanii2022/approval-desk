import { DatabaseSync } from "node:sqlite";

// The app's database file. Created by `npm run seed`; never committed.
export const DB_PATH = "data/approval-desk.db";

export function openDatabase(path: string = DB_PATH): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}
