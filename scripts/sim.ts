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
import { computeProgress, DAILY_GOAL, localDay, weeklyCounts } from '../lib/progress';
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
// Real getStudyQueue shuffles then caps at 21; order doesn't matter for tests.
function getStudyQueue(deckId: number, now: Date): Card[] {
  return getDueCards(deckId, now).slice(0, DAILY_GOAL);
}
function getAllCardsForPractice(deckId: number, now: Date): Card[] {
  return db.select().from(cards).where(eq(cards.deckId, deckId)).all();
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

// === S1: no hard cap — all due cards; practice includes not-due =============
console.log('\nS1 — Sessão limitada a 21 + prática (rever todos, sem cap)');
{
  const d = createDeck('Cap');
  for (let i = 0; i < 30; i++) createCard(d.id, `q${i}`, `a${i}`, t0);
  check('30 devidos → sessão limita a 21', getStudyQueue(d.id, t0).length === 21, `(got ${getStudyQueue(d.id, t0).length})`);
  // Review one as Good so it's no longer due "now".
  review(getDueCards(d.id, t0)[0], Rating.Good, t0);
  check('Após revisar 1, devidos (getDueCards) = 29', getDueCards(d.id, t0).length === 29, `(got ${getDueCards(d.id, t0).length})`);
  check('Prática (rever todos) é uncapped (30)', getAllCardsForPractice(d.id, t0).length === 30);
  check('DAILY_GOAL é 21', DAILY_GOAL === 21);
}

// === S2: ordering — reviews before new, ascending retrievability ===========
console.log('\nS2 — Utilitário orderForStudy (revisões antes de novos, retrievab. crescente)');
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
  check('Nenhuma revisão aparece depois de um card novo', !reviewsAfterNew, `(states=${states})`);

  const revs = q.filter((c) => c.state !== State.New);
  const rs = revs.map((c) => retrievability(c, tLater));
  const ascending = rs.every((v, i) => i === 0 || v >= rs[i - 1] - 1e-9);
  check('Revisões ordenadas por retrievabilidade crescente', ascending, `(${rs.map((v) => v.toFixed(2))})`);
}

// === S3: scheduling responds to answers ====================================
console.log('\nS3 — Agendamento reage às respostas');
{
  const d = createDeck('Sched');
  let c = createCard(d.id, 'Capital do Brasil?', 'Brasília', t0);
  check('Card novo começa no estado New', c.state === State.New);

  c = review(c, Rating.Good, t0);
  check('Após "Bom": due vai para o futuro', c.due.getTime() > t0.getTime());
  check('Após "Bom": reps incrementa', c.reps === 1, `(reps=${c.reps})`);

  const t1 = new Date(t0.getTime() + DAY);
  const stabBefore = c.stability;
  c = review(c, Rating.Good, t1);
  check('Segundo "Bom": estabilidade aumenta', c.stability > stabBefore, `(${stabBefore.toFixed(2)}→${c.stability.toFixed(2)})`);

  const t2 = new Date(t1.getTime() + DAY);
  const lapsesBefore = c.lapses;
  c = review(c, Rating.Again, t2);
  check('Após "De novo": lapses aumenta', c.lapses > lapsesBefore, `(${lapsesBefore}→${c.lapses})`);
  const minutesToDue = (c.due.getTime() - t2.getTime()) / 60000;
  check('Após "De novo": volta logo (≤ 1 dia)', minutesToDue <= 24 * 60, `(${minutesToDue.toFixed(0)} min)`);
}

// === S4: the loop — what you keep missing surfaces first ====================
console.log('\nS4 — O que você erra vem primeiro na próxima sessão');
{
  const d = createDeck('Loop');
  createCard(d.id, 'fácil', 'x', t0);
  createCard(d.id, 'difícil', 'y', t0);
  // 5 days: always get "fácil" right, always get "difícil" wrong.
  for (let day = 0; day < 5; day++) {
    const now = new Date(t0.getTime() + day * DAY);
    for (const card of getStudyQueue(d.id, now)) {
      review(card, card.front === 'fácil' ? Rating.Good : Rating.Again, now);
    }
  }
  const tFinal = new Date(t0.getTime() + 6 * DAY);
  const due = getStudyQueue(d.id, tFinal);
  const hasHard = due.some((c) => c.front === 'difícil');
  const hasEasy = due.some((c) => c.front === 'fácil');
  check('O card "difícil" (sempre errado) segue devido p/ revisar', hasHard, `(due=${due.map((c) => c.front)})`);
  check('O card "fácil" (sempre certo) foi agendado p/ o futuro (não devido)', !hasEasy);
}

// === S5: gamification (streak / daily goal / XP) — pure logic ===============
console.log('\nS5 — Gamificação: ofensiva, meta diária e XP');
{
  const today = '2026-06-10';
  const rows = [
    { day: '2026-06-08', count: 5 },
    { day: '2026-06-09', count: 25 },
    { day: '2026-06-10', count: 21 },
  ];
  const p = computeProgress(rows, today);
  check('Hoje conta 21 reviews', p.today === 21, `(${p.today})`);
  check('Meta batida (>=21)', p.goalMet === true);
  check('Ofensiva = 3 dias consecutivos', p.streak === 3, `(${p.streak})`);
  check('XP = total*10 = 510', p.xp === 510, `(${p.xp})`);
  check('Nível 3 com 510 XP', p.level === 3, `(${p.level})`);
  check('Progresso no nível = 110/500 XP', p.xpIntoLevel === 110 && p.xpForNext === 500, `(${p.xpIntoLevel}/${p.xpForNext})`);
  check('Últimos 7 dias = 7 colunas terminando em hoje', p.last7.length === 7 && p.last7[6].day === today);

  // No review today + a gap → streak counts only yesterday.
  const p2 = computeProgress([{ day: '2026-06-09', count: 3 }, { day: '2026-06-07', count: 2 }], today);
  check('Sem review hoje: ofensiva conta a partir de ontem (=1)', p2.streak === 1, `(${p2.streak})`);
  check('Meta não batida quando hoje=0', p2.goalMet === false && p2.today === 0);

  // Empty history → all zeros.
  const p3 = computeProgress([], today);
  check('Histórico vazio → ofensiva 0, hoje 0, xp 0', p3.streak === 0 && p3.today === 0 && p3.xp === 0);

  check('localDay formata YYYY-MM-DD', localDay(new Date('2026-06-04T09:00:00')) === '2026-06-04');
}

// === S6: bulk import parser =================================================
console.log('\nS6 — Parser de importação (texto colado → cards)');
{
  const text = [
    'Capital do Japão | Tóquio',
    '- Função da mitocôndria | Produzir energia (ATP)',
    '1. Quem escreveu Dom Casmurro | Machado de Assis',
    '',
    'linha de prosa sem separador deve ser ignorada',
    '   |   ',
  ].join('\n');
  const parsed = parseCards(text);
  check('Pega 3 cards (ignora prosa e linhas vazias)', parsed.length === 3, `(${parsed.length})`);
  check('Remove marcador "- "', parsed[1].front === 'Função da mitocôndria');
  check('Remove numeração "1. "', parsed[2].front === 'Quem escreveu Dom Casmurro');
  check('Frente/verso corretos', parsed[0].front === 'Capital do Japão' && parsed[0].back === 'Tóquio');
}

// === S8: weekly chart (since the beginning) =================================
console.log('\nS8 — Gráfico semanal (desde o início)');
{
  const today = '2026-06-10';
  const rows = [
    { day: '2026-06-10', count: 4 }, // current week
    { day: '2026-06-09', count: 6 }, // current week
    { day: '2026-05-28', count: 5 }, // ~2 weeks ago
  ];
  const wk = weeklyCounts(rows, today, 8);
  check('8 colunas semanais', wk.length === 8, `(${wk.length})`);
  check('Semana atual soma 10', wk[7].count === 10, `(${wk[7].count})`);
  check('Semana de 2 semanas atrás soma 5', wk[6].count === 5, `(${wk[6].count})`);
  check('Total semanal = 15', wk.reduce((s, w) => s + w.count, 0) === 15);
}

console.log(`\n==== ${pass} passaram, ${fail} falharam ====`);
process.exit(fail === 0 ? 0 : 1);
