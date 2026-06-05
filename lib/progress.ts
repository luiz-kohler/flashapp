// Daily goal + gamification, derived purely from review history (review_logs).
// Dependency-free on purpose, so the sim harness can test it in Node.

export const DAILY_GOAL = 21; // target reviews per day — a goal, NOT a hard cap.

// XP earned per review by rating (1=Again .. 4=Easy). Easy rewards the most.
export const XP_BY_RATING: Record<number, number> = { 1: 2, 2: 6, 3: 10, 4: 15 };
export function xpForRating(rating: number): number {
  return XP_BY_RATING[rating] ?? 10;
}

export type DailyCount = { day: string; count: number }; // day = 'YYYY-MM-DD' (local)

export type Progress = {
  today: number; // reviews done today
  goal: number;
  goalMet: boolean;
  streak: number; // consecutive days with >=1 review (ending today or yesterday)
  bestStreak: number; // longest such run ever (the user's record)
  totalReviews: number;
  xp: number; // 10 XP per review
  level: number;
  xpIntoLevel: number; // XP earned within the current level
  xpForNext: number; // XP span of the current level
  levelProgress: number; // 0..1 toward the next level
  last7: DailyCount[]; // oldest -> newest, for the mini chart
};

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// Local 'YYYY-MM-DD' for a Date.
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00`); // parsed as local time (no trailing Z)
  d.setDate(d.getDate() + delta);
  return localDay(d);
}

// XP→level curve: level N needs N^2 * 100 XP, so it slows down gracefully.
export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

export function computeProgress(
  rows: DailyCount[],
  today: string,
  totalXp?: number,
  goal = DAILY_GOAL
): Progress {
  const map = new Map(rows.map((r) => [r.day, r.count]));
  const todayCount = map.get(today) ?? 0;
  const totalReviews = rows.reduce((s, r) => s + r.count, 0);

  // Streak: walk backwards from today (or yesterday, if nothing logged yet today)
  // while each day has at least one review.
  let streak = 0;
  let cursor = todayCount > 0 ? today : addDays(today, -1);
  while ((map.get(cursor) ?? 0) > 0) {
    streak++;
    cursor = addDays(cursor, -1);
  }

  // Longest run of consecutive active days, ever (the record).
  const activeDays = rows
    .filter((r) => r.count > 0)
    .map((r) => r.day)
    .sort();
  let bestStreak = 0;
  let run = 0;
  let prevDay: string | null = null;
  for (const day of activeDays) {
    run = prevDay && addDays(prevDay, 1) === day ? run + 1 : 1;
    if (run > bestStreak) bestStreak = run;
    prevDay = day;
  }

  const last7: DailyCount[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = addDays(today, -i);
    last7.push({ day, count: map.get(day) ?? 0 });
  }

  // Weighted XP (by rating) is passed in; fall back to a flat estimate.
  const xp = totalXp ?? totalReviews * 10;
  const level = levelForXp(xp);
  const levelFloor = (level - 1) ** 2 * 100; // XP where this level starts
  const xpForNext = level ** 2 * 100 - levelFloor; // XP span of this level
  const xpIntoLevel = xp - levelFloor;
  return {
    today: todayCount,
    goal,
    goalMet: todayCount >= goal,
    streak,
    bestStreak,
    totalReviews,
    xp,
    level,
    xpIntoLevel,
    xpForNext,
    levelProgress: xpForNext > 0 ? xpIntoLevel / xpForNext : 0,
    last7,
  };
}

// Review totals bucketed into 7-day windows ending today — the "since you
// started" history. `day` is the first (oldest) date of each week. Oldest -> newest.
export function weeklyCounts(rows: DailyCount[], today: string, weeks = 8): DailyCount[] {
  const map = new Map(rows.map((r) => [r.day, r.count]));
  const out: DailyCount[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    let sum = 0;
    let start = today;
    for (let d = 0; d < 7; d++) {
      const day = addDays(today, -(w * 7 + d));
      sum += map.get(day) ?? 0;
      start = day; // ends on the oldest day of the bucket
    }
    out.push({ day: start, count: sum });
  }
  return out;
}

// Rotating motivational lines shown under the level on the Progresso tab.
export const MOTIVATION = [
  'Cada revisão te leva mais perto do próximo nível 🚀',
  'Constância vence intensidade — só mais alguns hoje!',
  'Seu cérebro adora repetição espaçada. Bora! 🧠',
  'Faltam poucos XP pro próximo nível — você consegue!',
  'Pequenos passos diários viram grande progresso 📈',
  'Revisar agora é lembrar amanhã ✨',
  'Mantém o ritmo: o próximo nível está logo ali!',
  'Disciplina hoje, conhecimento pra sempre 💪',
];
