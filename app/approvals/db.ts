import { existsSync } from "node:fs";
import { DB_PATH, openDatabase } from "../../lib/db.ts";

// The screen reads and writes the same database file the scripts use. The tests
// point it at their own file with APPROVAL_DESK_DB, so they never touch real data.
// A missing file is an error, not a new empty database.
export function appDb() {
  const path = process.env.APPROVAL_DESK_DB ?? DB_PATH;
  if (!existsSync(path)) throw new Error(`There is no database at ${path}`);
  return openDatabase(path);
}
