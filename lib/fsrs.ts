import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
} from 'ts-fsrs';

import type { Card as DbCard } from '@/db/schema';

// One shared scheduler instance. request_retention defaults to 0.9: FSRS aims to
// surface each card at the moment its predicted recall probability falls to ~90%.
// enable_fuzz spreads due dates a little so big batches don't all pile up on the
// same day.
const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

export { Rating, State };
export type ReviewGrade = Grade; // Again(1) | Hard(2) | Good(3) | Easy(4)

// The FSRS-owned columns on a card row, named once so insert/update stay in sync
// with the scheduler output. This is the seam between ts-fsrs and our DB shape.
export type CardFsrsState = {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: Date | null;
};

// DB row -> ts-fsrs Card (note: elapsed_days is deprecated in ts-fsrs and slated
// for removal in v6, but is still required by the Card interface in 5.x).
function toFsrsCard(card: DbCard): FsrsCard {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.lastReview ?? undefined,
  };
}

// ts-fsrs Card -> our column names.
function fromFsrsCard(c: FsrsCard): CardFsrsState {
  return {
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    lastReview: c.last_review ?? null,
  };
}

// Initial FSRS state for a brand-new card (state = New, due = now).
export function initialCardState(now: Date): CardFsrsState {
  return fromFsrsCard(createEmptyCard(now));
}

export type ReviewOutcome = {
  // New FSRS columns to write back onto the card row.
  card: CardFsrsState;
  // Row to append to review_logs (cardId is added by the caller).
  log: {
    rating: number;
    state: number;
    due: Date;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    lastElapsedDays: number;
    scheduledDays: number;
    review: Date;
  };
};

// Grade a card and get back its updated state + the log row to persist.
export function reviewCard(card: DbCard, grade: ReviewGrade, now: Date): ReviewOutcome {
  const { card: next, log } = scheduler.next(toFsrsCard(card), now, grade);
  return {
    card: fromFsrsCard(next),
    log: {
      rating: log.rating,
      state: log.state,
      due: log.due,
      stability: log.stability,
      difficulty: log.difficulty,
      elapsedDays: log.elapsed_days,
      lastElapsedDays: log.last_elapsed_days,
      scheduledDays: log.scheduled_days,
      review: log.review,
    },
  };
}

// Predicted next due-date for each rating, for "Good → 3d" style button labels.
export function previewDueDates(card: DbCard, now: Date): Record<ReviewGrade, Date> {
  const preview = scheduler.repeat(toFsrsCard(card), now);
  return {
    [Rating.Again]: preview[Rating.Again].card.due,
    [Rating.Hard]: preview[Rating.Hard].card.due,
    [Rating.Good]: preview[Rating.Good].card.due,
    [Rating.Easy]: preview[Rating.Easy].card.due,
  };
}

// Recall probability (0–1) for a card right now. New cards have no memory state,
// so we report 0 and let the ordering treat them separately.
export function retrievability(card: DbCard, now: Date): number {
  if (card.state === State.New) return 0;
  return scheduler.get_retrievability(toFsrsCard(card), now, false);
}

// "The best order based on your answers": reviews first, sorted by ASCENDING
// retrievability (the cards you're most likely to have forgotten come first —
// the science-backed order FSRS uses), then new cards.
export function orderForStudy(cardList: DbCard[], now: Date): DbCard[] {
  return cardList
    .map((c) => ({ c, isNew: c.state === State.New, r: retrievability(c, now) }))
    .sort((a, b) => {
      if (a.isNew !== b.isNew) return a.isNew ? 1 : -1; // reviews before new
      return a.r - b.r; // most-forgotten first
    })
    .map((x) => x.c);
}
