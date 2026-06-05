/**
 * Autonomous simulation harness (run: `npm run sim`).
 *
 * We can't drive the rendered iOS UI headlessly (no Xcode simulator; expo-sqlite
 * and expo-blur don't run on web). But the *brain* of the app — the FSRS
 * scheduling and "best order based on your answers" — is pure logic, so we test
 * it for real here:
 *   - the REAL schema (db/schema.ts) and REAL DDL (db/migrate.ts)
 *   - the REAL scheduler wrapper (lib/fsrs.ts)
 *   - a REAL SQLite engine (better-sqlite3) via the same Drizzle query API the
 *     app uses (drizzle-orm/better-sqlite3 instead of /expo-sqlite).
 *
 * The query helpers below mirror db/queries.ts line-for-line; only the db
 * connection differs. Time is simulated by passing explicit `now` values.
 */
import Database from 'better-sqlite3';
import { and, desc, eq, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { SCHEMA_DDL } from '../db/migrate';
import { cards, decks, reviewLogs, type Card } from '../db/schema';
import {
  initialCardState,
  orderForStudy,
  Rating,
  retrievability,
  reviewCard,
  State,
  type ReviewGrade,
} from '../lib/fsrs';
import { computeProgress, DAILY_GOAL, localDay, weeklyCounts, xpForRating } from '../lib/progress';
import { parseCards } from '../lib/parse-cards';

const sqlite = new Database(':memory:');
sqlite.exec(SCHEMA_DDL);
const db = drizzle(sqlite, { schema: { decks, cards, reviewLogs } });

// --- mirror of db/queries.ts (only the db source differs) ------------------
function createDeck(name: string) {
  return db.insert(decks).values({ name }).returning().get();
}
function createCard(deckId: number, front: string, back: string, now: Date) {
  return db
    .insert(cards)
    .values({ deckId, front, back, ...initialCardState(now) })
    .returning()
    .get();
}
function getDueCards(deckId: number, now: Date): Card[] {
  return db
    .select()
    .from(cards)
    .where(and(eq(cards.deckId, deckId), lte(cards.due, now)))
    .orderBy(cards.due)
    .all();
}
// Mirrors db/queries.ts#getStudySession. The real one reads `Date.now()`
// internally; here we accept `now` to keep simulations deterministic.
type StudyOrder = 'shuffle' | 'recent' | 'oldest';
type SessionLimit = number | 'all';
function shuffleArr<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function applyOrder<T extends { createdAt: Date }>(arr: T[], order: StudyOrder): T[] {
  if (order === 'recent') return [...arr].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (order === 'oldest') return [...arr].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return shuffleArr(arr);
}
function getStudySession(deckId: number, order: StudyOrder, limit: SessionLimit, now: Date): Card[] {
  const all = db.select().from(cards).where(eq(cards.deckId, deckId)).all();
  const byDueAsc = (a: Card, b: Card) => a.due.getTime() - b.due.getTime();
  const due = all.filter((c) => c.due.getTime() <= now.getTime()).sort(byDueAsc);
  const notDue = all.filter((c) => c.due.getTime() > now.getTime()).sort(byDueAsc);
  const prioritized = [...due, ...notDue];
  const picked = limit === 'all' ? prioritized : prioritized.slice(0, limit);
  return applyOrder(picked, order);
}
function review(card: Card, grade: ReviewGrade, now: Date): Card {
  const outcome = reviewCard(card, grade, now);
  db.transaction((tx) => {
    tx.update(cards).set(outcome.card).where(eq(cards.id, card.id)).run();
    tx.insert(reviewLogs).values({ cardId: card.id, ...outcome.log }).run();
  });
  return db.select().from(cards).where(eq(cards.id, card.id)).get()!;
}

// --- tiny assert framework -------------------------------------------------
let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${detail}`);
  }
}

const DAY = 86_400_000;
const t0 = new Date('2026-06-04T09:00:00Z');

// === S1: session size + due-first prioritization ===========================
console.log('\nS1 — Session size selector (5/10/15/20/all) with due-first fill');
{
  const d = createDeck('Cap');
  for (let i = 0; i < 30; i++) createCard(d.id, `q${i}`, `a${i}`, t0);
  check('limit=5 with 30 due → 5 cards', getStudySession(d.id, 'shuffle', 5, t0).length === 5);
  check('limit=20 with 30 due → 20 cards', getStudySession(d.id, 'shuffle', 20, t0).length === 20);
  check('limit="all" with 30 due → all 30', getStudySession(d.id, 'shuffle', 'all', t0).length === 30);
  // Review one as Good so it's no longer due "now".
  review(getDueCards(d.id, t0)[0], Rating.Good, t0);
  check('After reviewing 1, getDueCards = 29', getDueCards(d.id, t0).length === 29, `(got ${getDueCards(d.id, t0).length})`);
  check('limit="all" still returns all 30 (29 due + 1 not-due)', getStudySession(d.id, 'shuffle', 'all', t0).length === 30);
  check('DAILY_GOAL is 21', DAILY_GOAL === 21);

  // Fill behavior: when there are fewer due cards than the limit, the rest are
  // pulled from non-due. This is the fix for the "1/1 session after adding a
  // card" report — a fresh card is the only one due, but the user can still
  // study a full session of 5/10/20 by filling from already-learned cards.
  const f = createDeck('Fill');
  const onlyDue = createCard(f.id, 'fresh', '.', t0);
  const filler: Card[] = [];
  for (let i = 0; i < 4; i++) filler.push(createCard(f.id, `old${i}`, '.', t0));
  for (const c of filler) review(c, Rating.Good, t0); // push them into the future
  check('1 due of 5, limit=3 → 3 cards (due + 2 filled)', getStudySession(f.id, 'shuffle', 3, t0).length === 3);
  check(
    '1 due of 5, limit=3 → set always contains the due card',
    getStudySession(f.id, 'shuffle', 3, t0).some((c) => c.id === onlyDue.id)
  );
}

// === S2: ordering — reviews before new, ascending retrievability ===========
console.log('\nS2 — orderForStudy utility (reviews before new, ascending retrievability)');
{
  const d = createDeck('Order');
  const made: Card[] = [];
  for (let i = 0; i < 6; i++) made.push(createCard(d.id, `q${i}`, `a${i}`, t0));
  // Turn 4 into review-state cards by studying them across a few days; leave 2 new.
  for (let i = 0; i < 4; i++) {
    let c = made[i];
    for (let day = 0; day < 3; day++) c = review(c, Rating.Good, new Date(t0.getTime() + day * DAY));
  }
  const tLater = new Date(t0.getTime() + 6 * DAY);
  // orderForStudy is the optional "smart order" utility (default is now shuffle).
  const q = orderForStudy(getDueCards(d.id, tLater), tLater);
  const states = q.map((c) => c.state);
  const firstNew = states.findIndex((s) => s === State.New);
  const reviewsAfterNew = firstNew !== -1 && states.slice(firstNew).some((s) => s !== State.New);
  check('No review appears after a new card', !reviewsAfterNew, `(states=${states})`);

  const revs = q.filter((c) => c.state !== State.New);
  const rs = revs.map((c) => retrievability(c, tLater));
  const ascending = rs.every((v, i) => i === 0 || v >= rs[i - 1] - 1e-9);
  check('Reviews sorted by ascending retrievability', ascending, `(${rs.map((v) => v.toFixed(2))})`);
}

// === S3: scheduling responds to answers ====================================
console.log('\nS3 — Scheduling reacts to answers');
{
  const d = createDeck('Sched');
  let c = createCard(d.id, 'Capital of Brazil?', 'Brasília', t0);
  check('A new card starts in the New state', c.state === State.New);

  c = review(c, Rating.Good, t0);
  check('After "Good": due moves to the future', c.due.getTime() > t0.getTime());
  check('After "Good": reps increments', c.reps === 1, `(reps=${c.reps})`);

  const t1 = new Date(t0.getTime() + DAY);
  const stabBefore = c.stability;
  c = review(c, Rating.Good, t1);
  check('Second "Good": stability increases', c.stability > stabBefore, `(${stabBefore.toFixed(2)}→${c.stability.toFixed(2)})`);

  const t2 = new Date(t1.getTime() + DAY);
  const lapsesBefore = c.lapses;
  c = review(c, Rating.Again, t2);
  check('After "Again": lapses increase', c.lapses > lapsesBefore, `(${lapsesBefore}→${c.lapses})`);
  const minutesToDue = (c.due.getTime() - t2.getTime()) / 60000;
  check('After "Again": comes back soon (≤ 1 day)', minutesToDue <= 24 * 60, `(${minutesToDue.toFixed(0)} min)`);
}

// === S4: the loop — what you keep missing surfaces first ====================
console.log('\nS4 — What you miss surfaces first in the next session');
{
  const d = createDeck('Loop');
  createCard(d.id, 'easy', 'x', t0);
  createCard(d.id, 'hard', 'y', t0);
  // 5 days: always get "easy" right, always get "hard" wrong. We drive the
  // loop from getDueCards (not getStudySession) so the test exercises pure
  // FSRS scheduling without the deck-screen's "fill from non-due" behavior.
  for (let day = 0; day < 5; day++) {
    const now = new Date(t0.getTime() + day * DAY);
    for (const card of getDueCards(d.id, now)) {
      review(card, card.front === 'easy' ? Rating.Good : Rating.Again, now);
    }
  }
  const tFinal = new Date(t0.getTime() + 6 * DAY);
  const due = getDueCards(d.id, tFinal);
  const hasHard = due.some((c) => c.front === 'hard');
  const hasEasy = due.some((c) => c.front === 'easy');
  check('The "hard" card (always wrong) stays due for review', hasHard, `(due=${due.map((c) => c.front)})`);
  check('The "easy" card (always right) is scheduled for the future (not due)', !hasEasy);
}

// === S5: gamification (streak / daily goal / XP) — pure logic ===============
console.log('\nS5 — Gamification: streak, daily goal, and XP');
{
  const today = '2026-06-10';
  const rows = [
    { day: '2026-06-08', count: 5 },
    { day: '2026-06-09', count: 25 },
    { day: '2026-06-10', count: 21 },
  ];
  const p = computeProgress(rows, today);
  check('Today counts 21 reviews', p.today === 21, `(${p.today})`);
  check('Goal hit (>=21)', p.goalMet === true);
  check('Streak = 3 consecutive days', p.streak === 3, `(${p.streak})`);
  check('Best streak = 3', p.bestStreak === 3, `(${p.bestStreak})`);
  const pg = computeProgress(
    [
      { day: '2026-06-01', count: 1 },
      { day: '2026-06-02', count: 1 },
      { day: '2026-06-03', count: 1 },
      { day: '2026-06-04', count: 1 },
      { day: '2026-06-10', count: 1 },
    ],
    today
  );
  check('Best streak reflects the longest history (4) while current streak is 1', pg.bestStreak === 4 && pg.streak === 1, `(best ${pg.bestStreak}, cur ${pg.streak})`);
  check('XP = total*10 = 510', p.xp === 510, `(${p.xp})`);
  check('Level 3 at 510 XP', p.level === 3, `(${p.level})`);
  check('Progress within level = 110/500 XP', p.xpIntoLevel === 110 && p.xpForNext === 500, `(${p.xpIntoLevel}/${p.xpForNext})`);
  check(
    'xpForRating: Easy(15) > Good(10) > Hard(6) > Again(2)',
    xpForRating(4) === 15 && xpForRating(3) === 10 && xpForRating(2) === 6 && xpForRating(1) === 2
  );
  const pxp = computeProgress(rows, today, 1000);
  check('computeProgress uses the passed totalXp (1000) → level 4', pxp.xp === 1000 && pxp.level === 4, `(xp ${pxp.xp}, lvl ${pxp.level})`);
  check('Last 7 days = 7 columns ending today', p.last7.length === 7 && p.last7[6].day === today);

  // No review today + a gap → streak counts only yesterday.
  const p2 = computeProgress([{ day: '2026-06-09', count: 3 }, { day: '2026-06-07', count: 2 }], today);
  check('No review today: streak counts from yesterday (=1)', p2.streak === 1, `(${p2.streak})`);
  check('Goal not hit when today=0', p2.goalMet === false && p2.today === 0);

  // Empty history → all zeros.
  const p3 = computeProgress([], today);
  check('Empty history → streak 0, today 0, xp 0', p3.streak === 0 && p3.today === 0 && p3.xp === 0);

  check('localDay formats YYYY-MM-DD', localDay(new Date('2026-06-04T09:00:00')) === '2026-06-04');
}

// === S6: bulk import parser =================================================
console.log('\nS6 — Bulk import parser (pasted text → cards)');
{
  const text = [
    'Capital of Japan | Tokyo',
    '- Mitochondrion function | Produce energy (ATP)',
    '1. Who wrote Hamlet | William Shakespeare',
    '',
    'a prose line without a separator should be ignored',
    '   |   ',
  ].join('\n');
  const parsed = parseCards(text);
  check('Picks up 3 cards (ignores prose and empty lines)', parsed.length === 3, `(${parsed.length})`);
  check('Strips "- " bullet marker', parsed[1].front === 'Mitochondrion function');
  check('Strips "1. " numbering', parsed[2].front === 'Who wrote Hamlet');
  check('Front/back parsed correctly', parsed[0].front === 'Capital of Japan' && parsed[0].back === 'Tokyo');
}

// === S8: weekly chart (since the beginning) =================================
console.log('\nS8 — Weekly chart (since the beginning)');
{
  const today = '2026-06-10';
  const rows = [
    { day: '2026-06-10', count: 4 }, // current week
    { day: '2026-06-09', count: 6 }, // current week
    { day: '2026-05-28', count: 5 }, // ~2 weeks ago
  ];
  const wk = weeklyCounts(rows, today, 8);
  check('8 weekly columns', wk.length === 8, `(${wk.length})`);
  check('Current week sums to 10', wk[7].count === 10, `(${wk[7].count})`);
  check('Two weeks ago sums to 5', wk[6].count === 5, `(${wk[6].count})`);
  check('Weekly total = 15', wk.reduce((s, w) => s + w.count, 0) === 15);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail === 0 ? 0 : 1);
