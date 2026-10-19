// Shared data shapes. The database layout is described in README.md ("How it works").

export type Question = {
  q: string;
  /** Always 4 slots; an empty string means "no answer in this slot" (2- and 3-answer questions). */
  answers: string[];
  /** 0-based indexes of the correct answer(s). */
  correct: number[];
  /** Seconds. */
  time: number;
};

export type QuestionSet = {
  title: string;
  questions: Question[];
};

export type Settings = {
  /** Bonus per consecutive correct answer after the first. */
  streakStep: number;
  /** Maximum streak bonus per question. */
  streakCap: number;
  /** Seconds the question is shown before answers unlock. */
  previewSec: number;
  /** Let students join after the game has started. */
  lateJoin: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  streakStep: 100,
  streakCap: 500,
  previewSec: 5,
  lateJoin: true,
};

export type Phase = 'lobby' | 'question' | 'closing' | 'reveal' | 'board' | 'podium';

/** games/$pin/pub/state — read by every phone. */
export type PubState = {
  phase: Phase;
  /** Index of the current question (-1 in the lobby). */
  i: number;
  /** Database key of the current question's answers ("q0", "q1", …). */
  qk: string;
  total: number;
  /** Server time (ms) at which answers unlock. */
  startAt: number;
  limitMs: number;
};

/** games/$pin/pub/question — the current question WITHOUT the correct answer. */
export type PubQuestion = {
  i: number;
  q: string;
  answers: string[];
  time: number;
};

/** games/$pin/pub/reveal — published after the question closes. */
export type Reveal = {
  i: number;
  correct: number[];
  counts: number[];
  answered: number;
};

export type PubSettings = {
  locked: boolean;
  lateJoin: boolean;
};

export type Player = {
  name: string;
  joinedAt: number;
  on?: boolean;
};

export type Answer = {
  /** Chosen answer slot, 0–3. */
  c: number;
  /** Server time (ms) when the answer reached the database. */
  t: number;
};

export type LastResult = {
  i: number;
  answered: boolean;
  correct: boolean;
  c: number;
  /** Total points for this question (base + bonus). */
  pts: number;
  bonus: number;
};

/** games/$pin/results/$pid — written by the host, read by that player's phone. */
export type PlayerResult = {
  score: number;
  rank: number;
  of: number;
  streak: number;
  /** Points behind the player one place above (0 when first). */
  gap: number;
  last?: LastResult;
};

export type Score = {score: number; streak: number};

export type RankedRow = {pid: string; name: string; score: number; streak: number; rank: number};
