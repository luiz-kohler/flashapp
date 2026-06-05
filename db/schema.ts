import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// SQLite has no native date type, so every timestamp is stored as epoch
// milliseconds (an integer) and Drizzle's `timestamp_ms` mode hands us back a
// JS Date. Same idea as storing a DateTime as a long in SQL Server.
const nowMs = sql`(unixepoch() * 1000)`;

export const decks = sqliteTable('decks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  emoji: text('emoji').notNull().default('📚'),
  color: text('color').notNull().default('#6C5CE7'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
});

export const cards = sqliteTable('cards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // onDelete cascade: deleting a deck removes its cards (and their logs) in one
  // shot at the DB level instead of us cleaning up by hand.
  deckId: integer('deck_id')
    .notNull()
    .references(() => decks.id, { onDelete: 'cascade' }),
  front: text('front').notNull(),
  back: text('back').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),

  // --- FSRS scheduling state (mirrors the ts-fsrs Card object) ---
  due: integer('due', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  stability: real('stability').notNull().default(0),
  difficulty: real('difficulty').notNull().default(0),
  elapsedDays: integer('elapsed_days').notNull().default(0),
  scheduledDays: integer('scheduled_days').notNull().default(0),
  learningSteps: integer('learning_steps').notNull().default(0),
  reps: integer('reps').notNull().default(0),
  lapses: integer('lapses').notNull().default(0),
  state: integer('state').notNull().default(0), // 0=New 1=Learning 2=Review 3=Relearning
  lastReview: integer('last_review', { mode: 'timestamp_ms' }),
});

// One row per answer. Keeps the full FSRS log so we can later re-optimize the
// scheduler parameters from real review history (what Anki's FSRS optimizer does).
export const reviewLogs = sqliteTable('review_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: integer('card_id')
    .notNull()
    .references(() => cards.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(), // 1=Again 2=Hard 3=Good 4=Easy
  state: integer('state').notNull(),
  due: integer('due', { mode: 'timestamp_ms' }).notNull(),
  stability: real('stability').notNull(),
  difficulty: real('difficulty').notNull(),
  elapsedDays: integer('elapsed_days').notNull(),
  lastElapsedDays: integer('last_elapsed_days').notNull(),
  scheduledDays: integer('scheduled_days').notNull(),
  review: integer('review', { mode: 'timestamp_ms' }).notNull(),
});

export type Deck = typeof decks.$inferSelect;
export type NewDeck = typeof decks.$inferInsert;
export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type ReviewLog = typeof reviewLogs.$inferSelect;
