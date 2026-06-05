import { and, desc, eq, lte, sql } from 'drizzle-orm';

import { initialCardState, reviewCard, type ReviewGrade } from '@/lib/fsrs';
import { randomEmoji } from '@/lib/emojis';
import { DAILY_GOAL, xpForRating } from '@/lib/progress';
import { db } from './client';
import { cards, decks, reviewLogs, type Card } from './schema';

// Fisher–Yates shuffle — study order is randomized within a session.
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- Single deck -----------------------------------------------------------

export function getDeck(id: number) {
  return db.select().from(decks).where(eq(decks.id, id)).get();
}

// Live single-deck query so the deck screen reflects emoji/name changes.
export function deckById(id: number) {
  return db.select().from(decks).where(eq(decks.id, id));
}

export function updateDeck(id: number, fields: { name?: string; emoji?: string; color?: string }) {
  db.update(decks).set(fields).where(eq(decks.id, id)).run();
}

// Live list of every card in a deck (newest first) — for the browse screen.
export function cardsInDeck(deckId: number) {
  return db.select().from(cards).where(eq(cards.deckId, deckId)).orderBy(desc(cards.createdAt));
}

// The study queue: due cards, shuffled, capped at 21 per session so studying
// never gets tiring. FSRS still decides WHICH cards are due and WHEN they return;
// the within-session order is random. (Practice mode below is uncapped.)
export function getStudyQueue(deckId: number): Card[] {
  return shuffle(getDueCards(deckId)).slice(0, DAILY_GOAL);
}

// Practice mode: every card in the deck (even not-due), shuffled. Re-review freely.
export function getAllCardsForPractice(deckId: number): Card[] {
  return shuffle(db.select().from(cards).where(eq(cards.deckId, deckId)).all());
}

// --- Gamification (derived from review history) -----------------------------

// Reviews logged today (device-local day) — for the daily-goal indicator.
export function getReviewsToday(): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(reviewLogs)
    .where(sql`date(${reviewLogs.review} / 1000, 'unixepoch', 'localtime') = date('now', 'localtime')`)
    .get();
  return row?.n ?? 0;
}

// Live count of reviews per local day — feeds streak/XP/heatmap on Progresso.
export function dailyReviewCounts() {
  const day = sql<string>`date(${reviewLogs.review} / 1000, 'unixepoch', 'localtime')`;
  return db
    .select({ day, count: sql<number>`count(*)` })
    .from(reviewLogs)
    .groupBy(day)
    .orderBy(day);
}

// Total XP, weighted by rating (Easy worth more). Single source of truth for the
// weights is xpForRating in lib/progress.
export function getTotalXp(): number {
  const rows = db
    .select({ rating: reviewLogs.rating, n: sql<number>`count(*)` })
    .from(reviewLogs)
    .groupBy(reviewLogs.rating)
    .all();
  return rows.reduce((sum, r) => sum + r.n * xpForRating(r.rating), 0);
}

// --- Decks -----------------------------------------------------------------

export function createDeck(name: string, emoji?: string, color?: string) {
  // Random icon by default so decks don't all look the same.
  return db.insert(decks).values({ name, emoji: emoji ?? randomEmoji(), color }).returning().get();
}

// Live query: each deck plus its total card count and how many are due now.
// The two correlated subqueries run in SQLite. Columns are written with their
// fully-qualified SQL names ("cards"."deck_id", "decks"."id") because Drizzle
// drops the table prefix when interpolating `cards.deckId`/`decks.id` inside
// a `sql` template, and the bare "id" inside the subquery would otherwise
// resolve to "cards"."id" (the FROM of the subquery) instead of the outer
// "decks"."id" — turning the count into garbage whenever card.id ≠ deck.id.
// Same reason "due" is filtered in JS below: SQLite's `unixepoch()` is in
// seconds, multiplying by 1000 truncates sub-second precision and would
// briefly hide a just-created card.
export function decksWithCounts() {
  return db
    .select({
      id: decks.id,
      name: decks.name,
      emoji: decks.emoji,
      color: decks.color,
      total: sql<number>`(SELECT COUNT(*) FROM "cards" WHERE "cards"."deck_id" = "decks"."id")`,
      due: sql<number>`(SELECT COUNT(*) FROM "cards" WHERE "cards"."deck_id" = "decks"."id" AND "cards"."due" <= ${Date.now()})`,
    })
    .from(decks)
    .orderBy(desc(decks.createdAt));
}

// --- Cards -----------------------------------------------------------------

export function createCard(deckId: number, front: string, back: string) {
  const state = initialCardState(new Date());
  return db.insert(cards).values({ deckId, front, back, ...state }).returning().get();
}

// Cards in a deck that are due now, soonest first — the study queue.
export function getDueCards(deckId: number): Card[] {
  return db
    .select()
    .from(cards)
    .where(and(eq(cards.deckId, deckId), lte(cards.due, new Date())))
    .orderBy(cards.due)
    .all();
}

// --- Reviews ---------------------------------------------------------------

// Apply a grade: update the card's FSRS state and append a review log, atomically.
export function recordReview(card: Card, grade: ReviewGrade) {
  const outcome = reviewCard(card, grade, new Date());
  db.transaction((tx) => {
    tx.update(cards).set(outcome.card).where(eq(cards.id, card.id)).run();
    tx.insert(reviewLogs).values({ cardId: card.id, ...outcome.log }).run();
  });
  return outcome;
}

// Bulk-insert many cards (from pasted/AI-generated text), in one transaction.
export function createCardsBulk(deckId: number, pairs: { front: string; back: string }[]): number {
  if (pairs.length === 0) return 0;
  const now = new Date();
  db.transaction((tx) => {
    for (const p of pairs) {
      tx.insert(cards).values({ deckId, front: p.front, back: p.back, ...initialCardState(now) }).run();
    }
  });
  return pairs.length;
}

// --- Deletes ---------------------------------------------------------------
// FK cascade (PRAGMA foreign_keys = ON) removes children automatically:
// deleting a deck removes its cards + their review_logs; deleting a card removes
// its review_logs.
export function deleteCard(id: number) {
  db.delete(cards).where(eq(cards.id, id)).run();
}
export function deleteDeck(id: number) {
  db.delete(decks).where(eq(decks.id, id)).run();
}
