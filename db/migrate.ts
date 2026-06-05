// Schema applied at startup via execSync (see db/client.ts).
//
// We keep the schema as plain SQL here instead of using drizzle-kit's generated
// migrations because those require importing .sql files, which needs a Babel
// plugin — and on SDK 54 babel-preset-expo isn't resolvable from a custom
// babel.config.js. CREATE TABLE IF NOT EXISTS makes this idempotent.
//
// Keep this in sync with db/schema.ts (Drizzle still types every query).
// PRAGMA foreign_keys is per-connection: SQLite won't enforce FKs (or cascade
// deletes) unless you turn it on for the connection.
export const SCHEMA_DDL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS decks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '📚',
  color TEXT NOT NULL DEFAULT '#6C5CE7',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  due INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  elapsed_days INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  state INTEGER NOT NULL DEFAULT 0,
  last_review INTEGER
);

CREATE TABLE IF NOT EXISTS review_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  state INTEGER NOT NULL,
  due INTEGER NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  elapsed_days INTEGER NOT NULL,
  last_elapsed_days INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  review INTEGER NOT NULL
);
`;
