// Phone-side game client. Used by the student screen and by the load test, so both run the same code.
import {
  type Database,
  type Unsubscribe,
  get,
  goOffline,
  onDisconnect,
  onValue,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import type {PlayerResult, PubQuestion, PubSettings, PubState, Reveal} from './types.ts';

export type JoinError = 'not-found' | 'locked' | 'started' | 'ended' | 'taken' | 'network';

export class JoinFailed extends Error {
  code: JoinError;
  constructor(code: JoinError) {
    super(code);
    this.code = code;
  }
}

export type MyAnswer = {i: number; c: number; status: 'sending' | 'sent' | 'late'};

export type PlayerView = {
  status: 'playing' | 'kicked' | 'ended';
  connected: boolean;
  state?: PubState;
  question?: PubQuestion;
  reveal?: Reveal;
  result?: PlayerResult;
  answer?: MyAnswer;
};

const NAME_RE = /^[A-Za-z0-9฀-๿ _-]+$/;

/** Tidy a nickname; returns an error key when it can't be used. */
export function checkNickname(raw: string): {name: string; error?: 'empty' | 'long' | 'chars' | 'digits'} {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return {name, error: 'empty'};
  if (name.length > 15) return {name, error: 'long'};
  if (!NAME_RE.test(name)) return {name, error: 'chars'};
  // UTCC student IDs are 13 digits; refuse anything that looks like an ID.
  if (/\d{5,}/.test(name.replace(/[\s_-]/g, ''))) return {name, error: 'digits'};
  return {name};
}

/** Database key used to keep nicknames unique within a game (must match database.rules.json). */
export function nameKey(name: string): string {
  return name.toLowerCase().split(' ').join('');
}

export function newPlayerId(): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

function deniedError(e: unknown): boolean {
  return String((e as {code?: string})?.code ?? e).toLowerCase().includes('permission');
}

/** Before asking for a nickname: does the game exist and can new players join? */
export async function checkGame(db: Database, pin: string): Promise<JoinError | null> {
  if (!/^\d{6}$/.test(pin)) return 'not-found';
  try {
    const [st, se] = await Promise.all([get(ref(db, `games/${pin}/pub/state`)), get(ref(db, `games/${pin}/pub/settings`))]);
    const state = st.val() as PubState | null;
    const settings = se.val() as PubSettings | null;
    if (!state) return 'not-found';
    if (state.phase === 'podium') return 'ended';
    if (settings?.locked) return 'locked';
    if (state.phase !== 'lobby' && !settings?.lateJoin) return 'started';
    return null;
  } catch {
    return 'network';
  }
}

export class PlayerClient {
  db: Database;
  pin: string;
  pid: string;
  name: string;
  view: PlayerView = {status: 'playing', connected: false};
  offset = 0;
  private subs = new Set<(v: PlayerView) => void>();
  private unsubs: Unsubscribe[] = [];
  private joined = false;
  private stopped = false;

  constructor(db: Database, pin: string, pid: string, name: string) {
    this.db = db;
    this.pin = pin;
    this.pid = pid;
    this.name = name;
  }

  /** Join (or rejoin after a reload with the same player id). */
  async join(): Promise<void> {
    const base = `games/${this.pin}`;
    let existing;
    try {
      existing = await get(ref(this.db, `${base}/players/${this.pid}`));
    } catch {
      throw new JoinFailed('network');
    }
    if (!existing.exists()) {
      const why = await checkGame(this.db, this.pin);
      if (why) throw new JoinFailed(why);
      try {
        await update(ref(this.db), {
          [`${base}/players/${this.pid}`]: {name: this.name, joinedAt: serverTimestamp()},
          [`${base}/names/${nameKey(this.name)}`]: this.pid,
        });
      } catch (e) {
        if (!deniedError(e)) throw new JoinFailed('network');
        // Denied: the nickname is taken, unless the game closed in the meantime.
        throw new JoinFailed((await checkGame(this.db, this.pin)) ?? 'taken');
      }
    } else {
      this.name = (existing.val() as {name: string}).name;
    }
    this.joined = true;
    this.listen();
  }

  private listen() {
    const base = `games/${this.pin}`;
    const on = <T>(path: string, fn: (v: T | null) => void) =>
      this.unsubs.push(onValue(ref(this.db, path), (s) => fn(s.val() as T | null), () => {}));

    on<number>('.info/serverTimeOffset', (v) => (this.offset = v ?? 0));
    on<boolean>('.info/connected', (c) => {
      this.patch({connected: !!c});
      if (c && !this.stopped) {
        // Presence: "on" exists only while this phone is connected.
        const p = ref(this.db, `${base}/players/${this.pid}/on`);
        onDisconnect(p).remove().then(() => set(p, true)).catch(() => {});
      }
    });
    on<PubState>(`${base}/pub/state`, (state) => {
      if (!state) return this.confirmGone();
      const answer = this.view.answer && this.view.answer.i === state.i ? this.view.answer : undefined;
      this.patch({state, answer});
    });
    on<PubQuestion>(`${base}/pub/question`, (question) => this.patch({question: question ?? undefined}));
    on<Reveal>(`${base}/pub/reveal`, (reveal) => this.patch({reveal: reveal ?? undefined}));
    on<PlayerResult>(`${base}/results/${this.pid}`, (result) => result && this.patch({result}));
    on<{name: string}>(`${base}/players/${this.pid}`, (p) => {
      if (!p) this.confirmGone();
    });
  }

  /** The game or this player vanished: double-check with the server before giving up. */
  private async confirmGone() {
    if (!this.joined || this.stopped) return;
    await new Promise((r) => setTimeout(r, 1000));
    const base = `games/${this.pin}`;
    try {
      const [st, me] = await Promise.all([
        get(ref(this.db, `${base}/pub/state`)),
        get(ref(this.db, `${base}/players/${this.pid}`)),
      ]);
      if (!st.exists()) this.finish('ended');
      else if (!me.exists()) this.finish('kicked');
    } catch {
      // Offline: the listeners will fire again once reconnected.
    }
  }

  serverNow(): number {
    return Date.now() + this.offset;
  }

  /** Answers unlock at state.startAt (server time) and close at startAt + limit. */
  canAnswer(): boolean {
    const s = this.view.state;
    if (!s || s.phase !== 'question' || this.view.answer?.i === s.i) return false;
    const now = this.serverNow();
    return now >= s.startAt && now < s.startAt + s.limitMs;
  }

  async answer(c: number): Promise<MyAnswer['status']> {
    const s = this.view.state;
    if (!s || !this.canAnswer()) return 'late';
    const mine: MyAnswer = {i: s.i, c, status: 'sending'};
    this.patch({answer: mine});
    const target = ref(this.db, `games/${this.pin}/answers/${s.qk}/${this.pid}`);
    for (let attempt = 0; ; attempt++) {
      try {
        await set(target, {c, t: serverTimestamp()});
        mine.status = 'sent';
        break;
      } catch (e) {
        // A phone whose clock estimate is a little ahead can be refused just before the unlock time.
        const early = deniedError(e) && this.serverNow() < s.startAt + 1500 && attempt < 5;
        if (!early) {
          mine.status = 'late';
          break;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    if (this.view.answer === mine || this.view.answer?.i === s.i) this.patch({answer: {...mine}});
    return mine.status;
  }

  subscribe(fn: (v: PlayerView) => void): () => void {
    this.subs.add(fn);
    fn(this.view);
    return () => this.subs.delete(fn);
  }

  private patch(p: Partial<PlayerView>) {
    if (this.stopped) return;
    this.view = {...this.view, ...p};
    for (const fn of this.subs) fn(this.view);
  }

  /** Game over or removed: stop listening and close the connection (frees one of the 100 slots). */
  private finish(status: 'kicked' | 'ended') {
    if (this.stopped) return;
    this.patch({status});
    this.stop({disconnect: true});
  }

  /**
   * Stop listening. `disconnect` also closes the page's database connection — only do that when the
   * page is done with the database (the connection is shared with the join form).
   */
  stop({disconnect = false} = {}) {
    if (this.stopped) return;
    this.stopped = true;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (this.joined) {
      const p = ref(this.db, `games/${this.pin}/players/${this.pid}/on`);
      onDisconnect(p).cancel().catch(() => {});
      if (this.view.status === 'playing') remove(p).catch(() => {});
    }
    if (disconnect) setTimeout(() => goOffline(this.db), 300);
  }
}
