import type {Answer, LastResult, Question, RankedRow, Score, Settings} from './types.ts';

/** Kahoot-style "standard" points: 1000 for an instant answer, 500 at the buzzer. */
export function basePoints(responseMs: number, limitMs: number): number {
  const r = Math.min(Math.max(responseMs, 0), limitMs) / limitMs;
  return Math.round(1000 * (1 - r / 2));
}

/** Bonus for the n-th correct answer in a row: 0 for the first, then +step each, up to cap. */
export function streakBonus(streak: number, settings: Pick<Settings, 'streakStep' | 'streakCap'>): number {
  if (streak <= 1) return 0;
  return Math.min(settings.streakStep * (streak - 1), settings.streakCap);
}

/**
 * Score one question for every player still in the game.
 * `startAt` and every answer's `t` are server timestamps, so phone clocks play no part.
 */
export function scoreQuestion(
  i: number,
  question: Question,
  startAt: number,
  answers: Record<string, Answer>,
  playerIds: string[],
  prev: Record<string, Score>,
  settings: Settings,
): {scores: Record<string, Score>; last: Record<string, LastResult>; counts: number[]; answered: number} {
  const limitMs = question.time * 1000;
  const counts = [0, 0, 0, 0];
  let answered = 0;
  const scores: Record<string, Score> = {};
  const last: Record<string, LastResult> = {};
  for (const pid of playerIds) {
    const before = prev[pid] ?? {score: 0, streak: 0};
    const a = answers[pid];
    const valid = a && Number.isInteger(a.c) && a.c >= 0 && a.c < 4 && question.answers[a.c] !== '';
    if (valid) {
      counts[a.c]++;
      answered++;
    }
    const correct = !!valid && question.correct.includes(a.c);
    if (correct) {
      const streak = before.streak + 1;
      const base = basePoints(a.t - startAt, limitMs);
      const bonus = streakBonus(streak, settings);
      scores[pid] = {score: before.score + base + bonus, streak};
      last[pid] = {i, answered: true, correct: true, c: a.c, pts: base + bonus, bonus};
    } else {
      scores[pid] = {score: before.score, streak: 0};
      last[pid] = {i, answered: !!valid, correct: false, c: valid ? a.c : -1, pts: 0, bonus: 0};
    }
  }
  return {scores, last, counts, answered};
}

/** Highest score first; equal scores share a rank (1, 2, 2, 4). */
export function rank(rows: Omit<RankedRow, 'rank'>[]): RankedRow[] {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let prevScore = Number.NaN;
  let prevRank = 0;
  return sorted.map((r, idx) => {
    const rk = r.score === prevScore ? prevRank : idx + 1;
    prevScore = r.score;
    prevRank = rk;
    return {...r, rank: rk};
  });
}
