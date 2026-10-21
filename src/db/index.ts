import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

let instance: { db: Db; sqlite: Database.Database } | null = null;

function migrationsFolder() {
  // `drizzle/` sits at the project root in dev and is copied next to the
  // standalone server in the Docker image.
  return process.env.MIGRATIONS_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "drizzle");
}

/** Opens (and migrates) the database on first use. */
export function getDb(): Db {
  if (!instance) {
    fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });
    const sqlite = new Database(env.databasePath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: migrationsFolder() });
    instance = { db, sqlite };
  }
  return instance.db;
}

/** Test helper: close the connection so the next getDb() reopens it. */
export function closeDb() {
  instance?.sqlite.close();
  instance = null;
}

export { schema };
