import { and, desc, eq, lte, sql } from 'drizzle-orm';

import { initialCardState, reviewCard, type ReviewGrade } from '@/lib/fsrs';
import { randomEmoji } from '@/lib/emojis';
import { xpForRating } from '@/lib/progress';
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

// Within-session ordering. Mirrors the sort icons on the deck screen so the
// queue at play time matches what the user is seeing in the list. 'recent' =
// newest first; 'oldest' = oldest first (same icon, flipped on the UI).
export type StudyOrder = 'shuffle' | 'recent' | 'oldest';

function applyOrder<T extends { createdAt: Date }>(arr: T[], order: StudyOrder): T[] {
  if (order === 'recent') {
    return [...arr].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  if (order === 'oldest') {
    return [...arr].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  return shuffle(arr);
}

// Session size cap chosen by the user from the deck screen (5/10/15/20) or
// 'all' for no cap. Default lives in the UI.
export type SessionLimit = number | 'all';

// Builds a session of up to `limit` cards from the deck. FSRS-due cards take
// priority (in due-asc order so the most overdue come first); if there aren't
// enough due, we fill from non-due cards (also due-asc, i.e. the ones closest
// to becoming due come next). This is what lets the user keep a meaningful
// session even when only one card is technically due — the original report was
// "I just added a card and the session is 1/1". With this, picking size=20
// brings the new card in plus 19 non-due ones to actually practice.
//
// `order` (shuffle/recent/oldest) is applied LAST, within the selected set —
// the selection rule (due-first) decides which cards go in, the order rule
// decides the sequence the user sees them.
export function getStudySession(
  deckId: number,
  order: StudyOrder,
  limit: SessionLimit
): Card[] {
  const now = Date.now();
  const all = db.select().from(cards).where(eq(cards.deckId, deckId)).all();
  const byDueAsc = (a: Card, b: Card) => a.due.getTime() - b.due.getTime();
  const due = all.filter((c) => c.due.getTime() <= now).sort(byDueAsc);
  const notDue = all.filter((c) => c.due.getTime() > now).sort(byDueAsc);
  const prioritized = [...due, ...notDue];
  const picked = limit === 'all' ? prioritized : prioritized.slice(0, limit);
  return applyOrder(picked, order);
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

// Live query: each deck plus its total card count and the epoch-ms timestamp of
// the last review across all its cards (null if the deck was never studied).
// Columns are written with their fully-qualified SQL names ("cards"."deck_id",
// "decks"."id") because Drizzle drops the table prefix when interpolating
// `cards.deckId`/`decks.id` inside a `sql` template, and the bare "id" inside
// the subquery would otherwise resolve to "cards"."id" (the FROM of the
// subquery) instead of the outer "decks"."id".
export function decksWithCounts() {
  return db
    .select({
      id: decks.id,
      name: decks.name,
      emoji: decks.emoji,
      color: decks.color,
      total: sql<number>`(SELECT COUNT(*) FROM "cards" WHERE "cards"."deck_id" = "decks"."id")`,
      lastStudied: sql<number | null>`(
        SELECT MAX("review_logs"."review") FROM "review_logs"
        INNER JOIN "cards" ON "cards"."id" = "review_logs"."card_id"
        WHERE "cards"."deck_id" = "decks"."id"
      )`,
    })
    .from(decks)
    .orderBy(desc(decks.createdAt));
}

// --- Cards -----------------------------------------------------------------

export function createCard(deckId: number, front: string, back: string) {
  const state = initialCardState(new Date());
  return db.insert(cards).values({ deckId, front, back, ...state }).returning().get();
}

// Fetch one card by id (for the edit screen). Returns undefined if missing
// (e.g. user deleted it from another route).
export function getCard(id: number) {
  return db.select().from(cards).where(eq(cards.id, id)).get();
}

// Edit a card's content. Only the user-visible text changes — FSRS state
// (due/stability/etc) is intentionally left untouched, so editing a typo
// doesn't reset the scheduling history.
export function updateCard(id: number, fields: { front?: string; back?: string }) {
  db.update(cards).set(fields).where(eq(cards.id, id)).run();
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
