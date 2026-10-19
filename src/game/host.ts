// Host-side game engine: owns the question set, the timer and the scoring.
// The projector screen and the load test both drive this class.
import {
  type Database,
  type Unsubscribe,
  endAt,
  get,
  limitToFirst,
  onChildAdded,
  onValue,
  orderByChild,
  query,
  ref,
  serverTimestamp,
  update,
} from 'firebase/database';
import {rank, scoreQuestion} from './scoring.ts';
import type {
  Answer,
  Player,
  PlayerResult,
  PubSettings,
  PubState,
  QuestionSet,
  RankedRow,
  Reveal,
  Score,
  Settings,
} from './types.ts';

/** Games older than this may be deleted by anyone (see database.rules.json). */
export const STALE_MS = 3 * 60 * 60 * 1000;
/** Wait this long after the buzzer for answers still on their way. */
const CLOSE_GRACE_MS = 800;

export type HostView = {
  pin: string;
  set: QuestionSet;
  settings: Settings;
  state: PubState;
  pubSettings: PubSettings;
  players: Record<string, Player>;
  scores: Record<string, Score>;
  /** pids that answered the current question. */
  answered: string[];
  reveal?: Reveal;
  ranking: RankedRow[];
  /** Ranks before the latest question, for the leaderboard arrows. */
  prevRanks: Record<string, number>;
  connected: boolean;
  offset: number;
  error?: string;
};

type HostDoc = {set: QuestionSet; settings: Settings; scores?: Record<string, Score>; prevRanks?: Record<string, number>};

function randomPin(): string {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return String(100000 + (b[0] % 900000));
}

export class HostEngine {
  db: Database;
  view: HostView;
  private base: string;
  private subs = new Set<(v: HostView) => void>();
  private unsubs: Unsubscribe[] = [];
  private answerUnsub: Unsubscribe | null = null;
  private answers: Record<string, Answer> = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private destroyed = false;

  private constructor(db: Database, view: HostView) {
    this.db = db;
    this.view = view;
    this.base = `games/${view.pin}`;
  }

  /** Create a new game with a fresh 6-digit PIN. */
  static async create(db: Database, uid: string, set: QuestionSet, settings: Settings): Promise<HostEngine> {
    const pubSettings: PubSettings = {locked: false, lateJoin: settings.lateJoin};
    const state: PubState = {phase: 'lobby', i: -1, qk: '', total: set.questions.length, startAt: 0, limitMs: 0};
    for (let attempt = 0; attempt < 8; attempt++) {
      const pin = randomPin();
      try {
        await update(ref(db), {
          [`index/${pin}`]: {hostUid: uid, createdAt: serverTimestamp()},
          [`games/${pin}`]: {
            meta: {hostUid: uid, createdAt: serverTimestamp()},
            host: {set, settings} satisfies HostDoc,
            pub: {state, settings: pubSettings, title: set.title},
          },
        });
      } catch (e) {
        if (String((e as {code?: string}).code ?? e).toLowerCase().includes('permission')) continue; // PIN in use
        throw e;
      }
      const engine = new HostEngine(db, {
        pin,
        set,
        settings,
        state,
        pubSettings,
        players: {},
        scores: {},
        answered: [],
        ranking: [],
        prevRanks: {},
        connected: true,
        offset: 0,
      });
      engine.attach();
      return engine;
    }
    throw new Error('Could not find a free game PIN. Please try again.');
  }

  /** Pick up a game after the host page was reloaded. Returns null if it no longer exists. */
  static async resume(db: Database, uid: string, pin: string): Promise<HostEngine | null> {
    const meta = await get(ref(db, `games/${pin}/meta`)).catch(() => null);
    if (!meta?.exists() || meta.val().hostUid !== uid) return null;
    const [host, pub, players] = await Promise.all([
      get(ref(db, `games/${pin}/host`)),
      get(ref(db, `games/${pin}/pub`)),
      get(ref(db, `games/${pin}/players`)),
    ]);
    const h = host.val() as HostDoc;
    const p = pub.val() as {state: PubState; settings: PubSettings; reveal?: Reveal};
    const set = normaliseSet(h.set);
    const engine = new HostEngine(db, {
      pin,
      set,
      settings: h.settings,
      state: p.state,
      pubSettings: p.settings,
      players: (players.val() as Record<string, Player>) ?? {},
      scores: h.scores ?? {},
      answered: [],
      reveal: p.reveal,
      ranking: [],
      prevRanks: h.prevRanks ?? {},
      connected: true,
      offset: 0,
    });
    engine.view.ranking = engine.computeRanking();
    engine.attach();
    if (p.state.phase === 'closing') void engine.close();
    return engine;
  }

  /** Delete games whose host never pressed "End" (older than 3 hours). Safe to call at any time. */
  static async cleanupStale(db: Database, serverNow: number): Promise<number> {
    const q = query(ref(db, 'index'), orderByChild('createdAt'), endAt(serverNow - STALE_MS - 60_000), limitToFirst(100));
    const snap = await get(q);
    const doomed: Record<string, null> = {};
    snap.forEach((c) => {
      doomed[`games/${c.key}`] = null;
      doomed[`index/${c.key}`] = null;
    });
    if (Object.keys(doomed).length) await update(ref(db), doomed);
    return Object.keys(doomed).length / 2;
  }

  private attach() {
    const on = <T>(path: string, fn: (v: T | null) => void) =>
      this.unsubs.push(onValue(ref(this.db, path), (s) => fn(s.val() as T | null), () => {}));
    on<number>('.info/serverTimeOffset', (offset) => this.patch({offset: offset ?? 0}));
    on<boolean>('.info/connected', (c) => this.patch({connected: !!c}));
    on<Record<string, Player>>(`${this.base}/players`, (players) => {
      this.patch({players: players ?? {}});
      if (this.view.state.phase === 'question') this.patch({answered: this.answeredNow()});
    });
    const s = this.view.state;
    if (s.phase === 'question') this.listenAnswers(s.qk);
    this.timer = setInterval(() => this.tick(), 100);
  }

  subscribe(fn: (v: HostView) => void): () => void {
    this.subs.add(fn);
    fn(this.view);
    return () => this.subs.delete(fn);
  }

  private patch(p: Partial<HostView>) {
    this.view = {...this.view, ...p};
    for (const fn of this.subs) fn(this.view);
  }

  serverNow(): number {
    return Date.now() + this.view.offset;
  }

  /** Players currently in the game (removed players are deleted from the list). */
  playerIds(): string[] {
    return Object.keys(this.view.players);
  }

  onlineIds(): string[] {
    return Object.entries(this.view.players)
      .filter(([, p]) => p.on)
      .map(([pid]) => pid);
  }

  private answeredNow(): string[] {
    return Object.keys(this.answers).filter((pid) => this.view.players[pid]);
  }

  private listenAnswers(qk: string) {
    this.answerUnsub?.();
    this.answers = {};
    this.answerUnsub = onChildAdded(ref(this.db, `${this.base}/answers/${qk}`), (s) => {
      this.answers[s.key!] = s.val() as Answer;
      this.patch({answered: this.answeredNow()});
    });
  }

  private stopAnswers() {
    this.answerUnsub?.();
    this.answerUnsub = null;
  }

  /** Checks the timer; called every 100 ms (and by the host screen's background ticker). Safe to call any time. */
  tick() {
    const s = this.view.state;
    if (s.phase !== 'question' || this.busy) return;
    const now = this.serverNow();
    if (now >= s.startAt + s.limitMs + CLOSE_GRACE_MS) {
      void this.close();
      return;
    }
    const online = this.onlineIds();
    if (now >= s.startAt && online.length > 0 && online.every((pid) => this.answers[pid])) void this.close();
  }

  private async run(fn: () => Promise<void>) {
    if (this.busy || this.destroyed) return;
    this.busy = true;
    try {
      await fn();
      this.patch({error: undefined});
    } catch (e) {
      this.patch({error: `Could not reach the database (${(e as Error).message}). Check the connection and try again.`});
    } finally {
      this.busy = false;
    }
  }

  private async showQuestion(i: number) {
    const q = this.view.set.questions[i];
    const state: PubState = {
      phase: 'question',
      i,
      qk: `q${i}`,
      total: this.view.set.questions.length,
      startAt: Math.round(this.serverNow() + this.view.settings.previewSec * 1000),
      limitMs: q.time * 1000,
    };
    this.listenAnswers(state.qk);
    await update(ref(this.db, `${this.base}/pub`), {
      state,
      question: {i, q: q.q, answers: q.answers, time: q.time},
      reveal: null,
    });
    this.patch({state, reveal: undefined, answered: []});
  }

  /**
   * Lobby → first question; reveal → leaderboard (if turned on) or the next question, podium after the last;
   * leaderboard → next question. `skipBoard` goes from the reveal straight to the next question.
   */
  next({skipBoard = false} = {}): Promise<void> {
    return this.run(async () => {
      const s = this.view.state;
      const last = s.i >= s.total - 1;
      const board = this.view.settings.leaderboard !== false && !skipBoard;
      if (s.phase === 'lobby') await this.showQuestion(0);
      else if (s.phase === 'reveal') await (last ? this.setPhase('podium') : board ? this.setPhase('board') : this.showQuestion(s.i + 1));
      else if (s.phase === 'board') await (last ? this.setPhase('podium') : this.showQuestion(s.i + 1));
    });
  }

  /** Stop the timer now and score the question. */
  close(): Promise<void> {
    return this.run(async () => {
      const s = this.view.state;
      if (s.phase !== 'question' && s.phase !== 'closing') return;
      // 1. Stop accepting answers (the rules only accept answers while phase == "question").
      await update(ref(this.db, `${this.base}/pub/state`), {phase: 'closing'});
      this.patch({state: {...s, phase: 'closing'}});
      // 2. Read every answer the database accepted.
      const snap = await get(ref(this.db, `${this.base}/answers/${s.qk}`));
      const answers = {...this.answers, ...((snap.val() as Record<string, Answer>) ?? {})};
      this.stopAnswers();
      // 3. Score, rank and publish in one atomic write.
      const q = this.view.set.questions[s.i];
      const ids = this.playerIds();
      const prevRanks = Object.fromEntries(this.view.ranking.map((r) => [r.pid, r.rank]));
      const scored = scoreQuestion(s.i, q, s.startAt, answers, ids, this.view.scores, this.view.settings);
      const ranking = this.computeRanking(scored.scores);
      const reveal: Reveal = {i: s.i, correct: q.correct, counts: scored.counts, answered: scored.answered};
      const writes: Record<string, unknown> = {
        [`${this.base}/pub/state/phase`]: 'reveal',
        [`${this.base}/pub/reveal`]: reveal,
        [`${this.base}/host/scores`]: scored.scores,
        [`${this.base}/host/prevRanks`]: prevRanks,
      };
      ranking.forEach((r, idx) => {
        const above = ranking.slice(0, idx).reverse().find((x) => x.score > r.score);
        const result: PlayerResult = {
          score: r.score,
          rank: r.rank,
          of: ranking.length,
          streak: r.streak,
          gap: above ? above.score - r.score : 0,
          last: scored.last[r.pid],
        };
        writes[`${this.base}/results/${r.pid}`] = result;
      });
      await update(ref(this.db), writes);
      this.patch({
        state: {...s, phase: 'reveal'},
        reveal,
        scores: scored.scores,
        ranking,
        prevRanks,
        answered: Object.keys(answers),
      });
    });
  }

  /** Move on without scoring the current question. */
  skip(): Promise<void> {
    return this.run(async () => {
      const s = this.view.state;
      this.stopAnswers();
      if (s.i >= s.total - 1) await this.setPhase('podium');
      else await this.showQuestion(s.i + 1);
    });
  }

  /** Jump to the final podium with the scores so far. */
  finish(): Promise<void> {
    return this.run(async () => {
      this.stopAnswers();
      await this.setPhase('podium');
    });
  }

  private async setPhase(phase: 'board' | 'podium') {
    await update(ref(this.db, `${this.base}/pub/state`), {phase});
    this.patch({state: {...this.view.state, phase}});
  }

  kick(pid: string): Promise<void> {
    return this.run(async () => {
      await update(ref(this.db, this.base), {
        [`players/${pid}`]: null,
        [`kicked/${pid}`]: true,
        [`results/${pid}`]: null,
        [`host/scores/${pid}`]: null,
      });
      const scores = {...this.view.scores};
      delete scores[pid];
      this.patch({scores, ranking: this.computeRanking(scores)});
    });
  }

  setLocked(locked: boolean): Promise<void> {
    return this.run(async () => {
      await update(ref(this.db, `${this.base}/pub/settings`), {locked});
      this.patch({pubSettings: {...this.view.pubSettings, locked}});
    });
  }

  /** Delete everything stored for this game (nicknames, answers, scores). */
  async destroy(): Promise<void> {
    this.destroyed = true;
    this.detach();
    await update(ref(this.db), {[this.base]: null, [`index/${this.view.pin}`]: null});
  }

  detach() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopAnswers();
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  computeRanking(scores: Record<string, Score> = this.view.scores): RankedRow[] {
    return rank(
      Object.entries(this.view.players).map(([pid, p]) => ({
        pid,
        name: p.name,
        score: scores[pid]?.score ?? 0,
        streak: scores[pid]?.streak ?? 0,
      })),
    );
  }
}

/** The database turns arrays with empty strings back into arrays; make sure all four slots exist. */
export function normaliseSet(set: QuestionSet): QuestionSet {
  return {
    title: set.title,
    questions: (set.questions ?? []).map((q) => ({
      ...q,
      answers: [0, 1, 2, 3].map((k) => (q.answers ?? [])[k] ?? ''),
      correct: Object.values(q.correct ?? []),
    })),
  };
}
