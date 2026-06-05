// "Recommended" study order — a science-backed ordering that combines FSRS
// retrievability with answer-history signals and sequencing rules from the
// learning-science literature.
//
// Why a separate module from lib/fsrs.ts?
//   - lib/fsrs.ts is the thin bridge to ts-fsrs (just data shape + scheduling).
//   - Recommendation logic adds heuristics on TOP of FSRS (lapse history,
//     warmup, interleaving). Keeping it separate makes the FSRS layer easy to
//     swap and the recommendation rules easy to reason about.
//
// Methodologies it draws from:
//   1. Spaced repetition / desirable difficulty (Bjork): study cards near the
//      edge of forgetting — encoded by FSRS retrievability.
//   2. Lapse-based weighting: a card you keep missing is "fragile". Recent
//      lapses signal active forgetting; total lapses flag chronic leeches.
//   3. Learning/Relearning bias: mid-acquisition cards benefit from extra
//      reinforcement within the same session.
//   4. Warmup principle: starting with the absolute hardest item kills
//      momentum (and the "warmup effect" — first card is often missed even
//      when known). Lead with a moderate card if the top is an outlier.
//   5. Interleaving: spread new cards across the session rather than batching
//      at the end — gradual introduction beats blocked exposure.

import { retrievability, State } from './fsrs';
import type { Card as DbCard } from '@/db/schema';

// Stats derived from review_logs, per card. Provided by the caller (queries.ts
// batches one query per deck) so this module stays pure / testable.
export type CardStats = {
  // "Again" ratings in the last RECENT_WINDOW_DAYS days.
  recentLapseCount: number;
  // Cumulative "Again" ratings across all history (= card.lapses, but passed
  // explicitly so we don't tie this module to the schema column).
  totalLapses: number;
};

export const RECENT_WINDOW_DAYS = 14;

// Score weights. Roughly calibrated so that:
//   - a fully-forgotten card (r=0) sits at base 1.0
//   - a "leech" (≥5 recent lapses) gets +0.5
//   - a learning/relearning card gets +0.5
//   - a chronic problem (≥10 historical lapses) gets +0.2
// A new lapse-heavy learning card thus reaches ~2.0; a freshly-passed card at
// r=0.95 stays around 0.05 — wide enough range to actually re-rank cards that
// retrievability alone would tie.
const W_RECENT_LAPSE = 0.1;
const W_TOTAL_LAPSE = 0.02;
const W_LEARNING_STATE = 0.5;
const RECENT_LAPSE_CAP = 5;
const TOTAL_LAPSE_CAP = 10;

// Warmup threshold: if the top card's score is more than this much above the
// second card's, swap them. Chosen so this triggers only on outliers — most
// decks have several similarly-hard cards near the top and we don't want to
// reshuffle the whole front of the queue.
const WARMUP_GAP = 0.3;

// Higher = more urgent to study now. New cards get -Infinity here because
// they have no history to score; they're sequenced separately (interleaved).
export function priorityScore(card: DbCard, stats: CardStats, now: Date): number {
  if (card.state === State.New) return -Infinity;
  const forgetting = 1 - retrievability(card, now); // [0..1]
  const stateBoost =
    card.state === State.Learning || card.state === State.Relearning ? W_LEARNING_STATE : 0;
  const recentBoost = Math.min(stats.recentLapseCount, RECENT_LAPSE_CAP) * W_RECENT_LAPSE;
  const totalBoost = Math.min(stats.totalLapses, TOTAL_LAPSE_CAP) * W_TOTAL_LAPSE;
  return forgetting + stateBoost + recentBoost + totalBoost;
}

// Evenly insert `news` into `reviews`. Example with 6 reviews + 2 news:
//   ratio = 6/2 = 3 → emit a new card after every 3 reviews
//   result = [r1, r2, r3, n1, r4, r5, r6, n2]
// We place the new card AFTER a block of reviews so the session starts with a
// known card (warmup with familiar material; new items appear once the user is
// already "in the zone").
export function interleaveNews(reviews: DbCard[], news: DbCard[]): DbCard[] {
  if (news.length === 0) return reviews;
  if (reviews.length === 0) return news;
  const ratio = reviews.length / news.length;
  const out: DbCard[] = [];
  let ni = 0;
  let nextNewAt = ratio; // 1-indexed position where the next new card lands
  for (let i = 0; i < reviews.length; i++) {
    out.push(reviews[i]);
    if (ni < news.length && i + 1 >= nextNewAt) {
      out.push(news[ni++]);
      nextNewAt += ratio;
    }
  }
  while (ni < news.length) out.push(news[ni++]); // any leftovers go at the end
  return out;
}

// Main entry point. Reorders `cardList` according to the score + sequencing
// rules described at the top of this file.
export function recommendedOrder(
  cardList: DbCard[],
  statsByCardId: Map<number, CardStats>,
  now: Date
): DbCard[] {
  const reviews = cardList.filter((c) => c.state !== State.New);
  const news = cardList.filter((c) => c.state === State.New);

  const scored = reviews
    .map((c) => ({
      c,
      s: priorityScore(
        c,
        statsByCardId.get(c.id) ?? { recentLapseCount: 0, totalLapses: c.lapses },
        now
      ),
    }))
    .sort((a, b) => b.s - a.s);

  // Warmup: if the top is an outlier (big score gap to #2), lead with #2 and
  // let the hardest card land at position 2. The user gets a small win first,
  // which research on session-opening primes suggests improves later recall.
  if (scored.length >= 2 && scored[0].s - scored[1].s > WARMUP_GAP) {
    [scored[0], scored[1]] = [scored[1], scored[0]];
  }

  return interleaveNews(
    scored.map((x) => x.c),
    news
  );
}
