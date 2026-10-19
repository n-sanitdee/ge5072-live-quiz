// Load test: N simulated phones play the full warm-up set against one host, using the same
// PlayerClient / HostEngine code as the real screens. Every answer and every score is checked.
//
//   npm run emulators                       # terminal 1 (local emulators)
//   node tests/load-test.ts --players 60    # terminal 2
//   node tests/load-test.ts --players 60 --live   # against the real Firebase project
//
// Options: --players N  --preview S  --skip P (chance a player doesn't answer)  --flaky N (players whose
// connection drops for a few seconds)  --reload N (players who reload the page mid-game)  --live
import {mkdirSync, writeFileSync} from 'node:fs';
import {deleteApp} from 'firebase/app';
import {get, goOffline, goOnline, ref} from 'firebase/database';
import {firebaseConfig} from '../src/firebase-config.ts';
import {EMULATOR_CONFIG, openDatabase, signInHost} from '../src/game/fb.ts';
import {HostEngine} from '../src/game/host.ts';
import {PlayerClient, newPlayerId} from '../src/game/player.ts';
import {parseSetJson} from '../src/game/sets.ts';
import {DEFAULT_SETTINGS, type Answer, type PlayerResult, type QuestionSet} from '../src/game/types.ts';
import warmup from '../src/sets/warmup-1-2026.json' with {type: 'json'};

const args = process.argv.slice(2);
const opt = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const LIVE = args.includes('--live');
const N = opt('players', 60);
const PREVIEW = opt('preview', 5);
const SKIP = opt('skip', 0.03);
const FLAKY = opt('flaky', Math.round(N / 12));
const RELOAD = opt('reload', 2);
const backend = LIVE ? {config: firebaseConfig} : {config: EMULATOR_CONFIG, emulatorHost: '127.0.0.1'};
if (LIVE && !firebaseConfig.databaseURL) throw new Error('src/firebase-config.ts is empty');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (xs: number[]) => ({n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), max: xs.length ? Math.max(...xs) : NaN});

// Independent copy of the scoring rule (deliberately not imported from src/game/scoring.ts).
function expectedPoints(rt: number, limitMs: number, streak: number) {
  const base = Math.round(1000 * (1 - Math.min(Math.max(rt, 0), limitMs) / limitMs / 2));
  const bonus = streak <= 1 ? 0 : Math.min(DEFAULT_SETTINGS.streakStep * (streak - 1), DEFAULT_SETTINGS.streakCap);
  return base + bonus;
}

const set: QuestionSet = parseSetJson(JSON.stringify(warmup));
const settings = {...DEFAULT_SETTINGS, previewSec: PREVIEW};

type Sim = {
  k: number;
  name: string;
  pid: string;
  app: ReturnType<typeof openDatabase>;
  client: PlayerClient;
  flaky: boolean;
  reload: boolean;
  sent: Record<number, {c: number; status: string; ackMs: number}>;
  seenQ: Record<number, number>; // question index → SERVER ms when the phone saw it
  seenResult: Record<number, number>;
  maxOffsetDiff: number;
};

const issues: string[] = [];
const fail = (m: string) => {
  issues.push(m);
  log('ISSUE', m);
};

// ---------------------------------------------------------------- host
const hostApp = openDatabase(backend, 'host');
const uid = await signInHost(hostApp.app, backend);
const host = await HostEngine.create(hostApp.db, uid, set, settings);
const pin = host.view.pin;
log(`game ${pin} created (${LIVE ? 'LIVE Firebase' : 'emulator'}), ${N} players, ${set.questions.length} questions`);
const questionWrittenAt: Record<number, number> = {}; // question index → server ms the host published it
const closedAt: Record<number, number> = {}; // question index → local ms the host stopped answers

// ---------------------------------------------------------------- players
const sims: Sim[] = [];
function wire(sim: Sim) {
  let lastI = -2;
  sim.client.subscribe((v) => {
    const s = v.state;
    if (!s) return;
    sim.maxOffsetDiff = Math.max(sim.maxOffsetDiff, Math.abs(sim.client.offset - host.view.offset));
    if (s.phase === 'question' && s.i !== lastI) {
      lastI = s.i;
      sim.seenQ[s.i] ??= sim.client.serverNow();
      questionWrittenAt[s.i] = s.startAt - PREVIEW * 1000; // the host's server time when it published
      void play(sim, s.i, s.startAt);
    }
    if (v.result?.last && v.result.last.i === s.i && !sim.seenResult[s.i]) sim.seenResult[s.i] = Date.now();
  });
}

async function play(sim: Sim, i: number, startAt: number) {
  if (sim.sent[i]) return;
  if (Math.random() < SKIP) return; // this player doesn't answer
  const q = set.questions[i];
  const limit = q.time * 1000;
  const think = 600 + Math.random() * (limit * 0.85 - 600);
  const correct = Math.random() < 0.65;
  const options = q.answers.map((a, k) => (a ? k : -1)).filter((k) => k >= 0);
  const wrong = options.filter((k) => !q.correct.includes(k));
  const c = correct ? q.correct[0] : wrong[Math.floor(Math.random() * wrong.length)];
  await sleep(Math.max(0, startAt + think - sim.client.serverNow()));
  if (sim.client.view.state?.i !== i || sim.client.view.state.phase !== 'question') return;
  const t = Date.now();
  sim.sent[i] = {c, status: 'pending', ackMs: 0};
  const status = await sim.client.answer(c);
  sim.sent[i] = {c, status, ackMs: Date.now() - t};
}

const joinMs: number[] = [];
const joinErrors: string[] = [];
await Promise.all(
  Array.from({length: N}, async (_, k) => {
    await sleep(Math.random() * 8000); // a class scanning the QR code over ~8 s
    const app = openDatabase(backend, `p${k}`);
    const name = `Player ${String(k + 1).padStart(2, '0')}`;
    const client = new PlayerClient(app.db, pin, newPlayerId(), name);
    const t = Date.now();
    try {
      await client.join();
      joinMs.push(Date.now() - t);
    } catch (e) {
      joinErrors.push(`${name}: ${(e as Error).message}`);
      return;
    }
    const sim: Sim = {
      k,
      name,
      pid: client.pid,
      app,
      client,
      flaky: k < FLAKY,
      reload: k >= FLAKY && k < FLAKY + RELOAD,
      sent: {},
      seenQ: {},
      seenResult: {},
      maxOffsetDiff: 0,
    };
    sims.push(sim);
    wire(sim);
  }),
);
await sleep(1500);
const seen = Object.keys(host.view.players).length;
log(`joined: ${sims.length}/${N} (host sees ${seen}, online ${host.onlineIds().length}); join ms`, stats(joinMs));
if (joinErrors.length) fail(`join errors: ${joinErrors.join('; ')}`);
if (seen !== N) fail(`host sees ${seen} players, expected ${N}`);

// Flaky connections: drop for 2–6 s at random moments during the game.
for (const sim of sims.filter((s) => s.flaky)) {
  void (async () => {
    for (let n = 0; n < 3; n++) {
      await sleep(20_000 + Math.random() * 90_000);
      goOffline(sim.app.db);
      await sleep(2000 + Math.random() * 4000);
      goOnline(sim.app.db);
    }
  })();
}
// Page reloads: a new client with the same player id (as the real page does from localStorage).
for (const sim of sims.filter((s) => s.reload)) {
  void (async () => {
    await sleep(60_000 + Math.random() * 60_000);
    sim.client.stop({disconnect: true}); // the old page is gone
    await sleep(2500);
    const app = openDatabase(backend, `p${sim.k}r`);
    const client = new PlayerClient(app.db, pin, sim.pid, sim.name);
    await client.join();
    sim.app = app;
    sim.client = client;
    wire(sim);
    log(`${sim.name} reloaded and rejoined`);
  })();
}

// ---------------------------------------------------------------- game loop + checks
const expected: Record<string, {score: number; streak: number}> = {};
const perQuestion: {i: number; answered: number; late: number; closeMs: number; reason: string}[] = [];
host.subscribe((v) => {
  if (v.state.phase === 'closing' && closedAt[v.state.i] === undefined) closedAt[v.state.i] = Date.now();
});

for (let i = 0; i < set.questions.length; i++) {
  await host.next(); // lobby/board → question i
  const s = host.view.state;
  const deadline = Date.now() + s.limitMs + PREVIEW * 1000 + 30_000;
  while (host.view.state.phase !== 'reveal' && Date.now() < deadline) await sleep(50);
  if (host.view.state.phase !== 'reveal') {
    fail(`Q${i + 1}: host never revealed (${host.view.error ?? 'no error'})`);
    break;
  }
  const closeMs = host.serverNow() - s.startAt;
  const reason = closeMs < s.limitMs ? 'all answered' : 'time up';
  await sleep(1200); // let results reach phones

  const answers = ((await get(ref(hostApp.db, `games/${pin}/answers/${s.qk}`))).val() ?? {}) as Record<string, Answer>;
  const results = ((await get(ref(hostApp.db, `games/${pin}/results`))).val() ?? {}) as Record<string, PlayerResult>;
  let late = 0;
  for (const sim of sims) {
    const sent = sim.sent[i];
    if (sent?.status === 'sent' && answers[sim.pid]?.c !== sent.c) fail(`Q${i + 1}: ${sim.name}'s acknowledged answer is missing`);
    if (sent?.status === 'late') late++;
    if (sent?.status === 'pending' && !sim.flaky && !sim.reload) fail(`Q${i + 1}: ${sim.name}'s answer never got a reply`);
    // independent score check
    const prev = expected[sim.pid] ?? {score: 0, streak: 0};
    const a = answers[sim.pid];
    const q = set.questions[i];
    if (a && q.correct.includes(a.c)) {
      const streak = prev.streak + 1;
      expected[sim.pid] = {score: prev.score + expectedPoints(a.t - s.startAt, s.limitMs, streak), streak};
    } else expected[sim.pid] = {score: prev.score, streak: 0};
    const r = results[sim.pid];
    if (!r) fail(`Q${i + 1}: no result for ${sim.name}`);
    else if (r.score !== expected[sim.pid].score || r.streak !== expected[sim.pid].streak)
      fail(`Q${i + 1}: ${sim.name} score ${r.score}/streak ${r.streak}, expected ${expected[sim.pid].score}/${expected[sim.pid].streak}`);
    if (a && (a.t < s.startAt || a.t > s.startAt + s.limitMs + 2000)) fail(`Q${i + 1}: answer outside the window for ${sim.name}`);
  }
  const answered = Object.keys(answers).length;
  perQuestion.push({i, answered, late, closeMs, reason});
  log(`Q${i + 1}: ${answered}/${N} answered, ${late} late, closed after ${(closeMs / 1000).toFixed(1)}s (${reason})`);
  await host.next(); // reveal → board (or podium after the last question)
  await sleep(800);
}
if (host.view.state.phase === 'board') await host.next();
await sleep(1500);
const podiumOk = sims.filter((s) => s.client.view.state?.phase === 'podium').length;
log(`podium reached on ${podiumOk}/${sims.length} phones`);
if (podiumOk !== sims.length) fail(`only ${podiumOk}/${sims.length} phones reached the podium`);

// ---------------------------------------------------------------- latency + timer sync
const propagation: number[] = [];
const resultDelivery: number[] = [];
for (const sim of sims) {
  for (const [i, t] of Object.entries(sim.seenQ)) if (questionWrittenAt[+i]) propagation.push(t - questionWrittenAt[+i]);
  for (const [i, t] of Object.entries(sim.seenResult)) if (closedAt[+i]) resultDelivery.push(t - closedAt[+i]);
}
const acks = sims.flatMap((s) => Object.values(s.sent).filter((x) => x.status === 'sent').map((x) => x.ackMs));
const offsetDiff = sims.map((s) => s.maxOffsetDiff);
for (const sim of sims)
  for (const [i, x] of Object.entries(sim.sent)) if (x.status === 'pending') fail(`Q${+i + 1}: ${sim.name}'s answer never got a reply`);
const totalSent = sims.reduce((n, s) => n + Object.values(s.sent).filter((x) => x.status === 'sent').length, 0);
const totalLate = sims.reduce((n, s) => n + Object.values(s.sent).filter((x) => x.status === 'late').length, 0);

// ---------------------------------------------------------------- clean up
await host.destroy();
await sleep(2000);
const leftover = await get(ref(hostApp.db, `games/${pin}/meta`)).catch(() => null);
if (leftover?.exists()) fail('game data still present after destroy()');
const endedOk = sims.filter((s) => s.client.view.status === 'ended').length;
const cleaned = await HostEngine.cleanupStale(hostApp.db, host.serverNow()).then(
  (n) => `ok (${n} stale)`,
  (e) => `FAILED ${e}`,
);
if (cleaned.startsWith('FAILED')) fail(`stale cleanup query refused: ${cleaned}`);

const report = {
  when: new Date().toISOString(),
  backend: LIVE ? 'live Firebase (asia-southeast1)' : 'local emulator',
  players: N,
  questions: set.questions.length,
  joined: sims.length,
  joinMs: stats(joinMs),
  answersAcknowledged: totalSent,
  answersLate: totalLate,
  flakyPlayers: FLAKY,
  reloadingPlayers: RELOAD,
  questionPublishToPhoneMs: stats(propagation),
  // from the host stopping answers to the phone showing its points (includes reading answers + scoring)
  answerAckMs: stats(acks),
  closeToResultOnPhoneMs: stats(resultDelivery),
  phoneVsHostClockOffsetDiffMs: stats(offsetDiff),
  perQuestion,
  phonesSawGameEnd: endedOk,
  staleCleanup: cleaned,
  issues,
};
mkdirSync('tests/out', {recursive: true});
const file = `tests/out/load-${LIVE ? 'live' : 'emulator'}-${N}p-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`;
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(JSON.stringify({...report, perQuestion: undefined}, null, 2));
console.log(issues.length ? `\n${issues.length} ISSUES — see ${file}` : `\nPASS — report in ${file}`);
for (const s of sims) await deleteApp(s.app.app).catch(() => {});
await deleteApp(hostApp.app).catch(() => {});
process.exit(issues.length ? 1 : 0);

