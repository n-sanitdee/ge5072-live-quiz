// Security-rules and engine smoke test against the local emulators.
// Run: npm run emulators   (in another terminal)   then   node tests/rules-test.ts
import {deleteApp} from 'firebase/app';
import {get, ref, serverTimestamp, set, update} from 'firebase/database';
import {EMULATOR_CONFIG, openDatabase, signInHost} from '../src/game/fb.ts';
import {HostEngine} from '../src/game/host.ts';
import {JoinFailed, PlayerClient, newPlayerId} from '../src/game/player.ts';
import {DEFAULT_SETTINGS, type QuestionSet} from '../src/game/types.ts';

const backend = {config: EMULATOR_CONFIG, emulatorHost: '127.0.0.1'};
let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}
async function denied(p: Promise<unknown>): Promise<boolean> {
  try {
    await p;
    return false;
  } catch (e) {
    return String((e as {code?: string}).code ?? e).toLowerCase().includes('permission');
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const set2: QuestionSet = {
  title: 'Rules test',
  questions: [
    {q: 'Two plus two?', answers: ['3', '4', '', ''], correct: [1], time: 5},
    {q: 'Pick red', answers: ['red', 'blue', 'green', 'yellow'], correct: [0], time: 5},
  ],
};

const hostApp = openDatabase(backend, 'host');
const uid = await signInHost(hostApp.app, backend);
const host = await HostEngine.create(hostApp.db, uid, set2, {...DEFAULT_SETTINGS, previewSec: 1, lateJoin: false});
const pin = host.view.pin;
console.log('PIN', pin);

const apps = [0, 1, 2].map((k) => openDatabase(backend, `p${k}`));
const players = apps.map((a, k) => new PlayerClient(a.db, pin, newPlayerId(), ['Ann', 'Bo', 'Cy'][k]));
await Promise.all(players.map((p) => p.join()));
await sleep(500);
check('3 players joined and host sees them', Object.keys(host.view.players).length === 3);
check('host sees presence', host.onlineIds().length === 3);

// Duplicate nickname (case/space-insensitive)
const dupApp = openDatabase(backend, 'dup');
const dup = new PlayerClient(dupApp.db, pin, newPlayerId(), 'a nn');
let dupErr = '';
try {
  await dup.join();
} catch (e) {
  dupErr = (e as JoinFailed).code;
}
check('duplicate nickname refused ("a nn" vs "Ann")', dupErr === 'taken');

// Hostile writes go through a separate connection so the real phones' screens aren't disturbed.
const pdb = openDatabase(backend, 'attacker').db;
const base = `games/${pin}`;
check('player cannot read the host node (correct answers)', await denied(get(ref(pdb, `${base}/host`))));
check('player cannot list players', await denied(get(ref(pdb, `${base}/players`))));
check('player cannot list answers', await denied(get(ref(pdb, `${base}/answers`))));
check('player cannot change the game state', await denied(set(ref(pdb, `${base}/pub/state/phase`), 'podium')));
check('player cannot write results', await denied(set(ref(pdb, `${base}/results/${players[0].pid}/score`), 9999)));
check('player cannot list games', await denied(get(ref(pdb, 'games'))));
check('player cannot read the game index', await denied(get(ref(pdb, 'index'))));
check('player cannot delete the game', await denied(set(ref(pdb, base), null)));
check(
  'player cannot answer in the lobby',
  await denied(set(ref(pdb, `${base}/answers/q0/${players[0].pid}`), {c: 1, t: serverTimestamp()})),
);
check(
  'player cannot rename themselves',
  await denied(set(ref(pdb, `${base}/players/${players[0].pid}/name`), 'Zed')),
);

await host.next(); // question 0, answers unlock in 1 s
await sleep(200);
check('phones see the question without the correct answer', !('correct' in (players[0].view.question ?? {})));
check(
  'answer before unlock time is refused',
  await denied(set(ref(pdb, `${base}/answers/q0/${players[0].pid}`), {c: 1, t: serverTimestamp()})),
);
await sleep(1000);
check(
  'answer with a faked timestamp is refused',
  await denied(set(ref(pdb, `${base}/answers/q0/${players[0].pid}`), {c: 1, t: 1})),
);
check(
  'answer for a made-up player id is refused',
  await denied(set(ref(pdb, `${base}/answers/q0/${newPlayerId()}`), {c: 1, t: serverTimestamp()})),
);
check(
  'answer for the wrong question is refused',
  await denied(set(ref(pdb, `${base}/answers/q1/${players[0].pid}`), {c: 1, t: serverTimestamp()})),
);
check('player 0 answers', (await players[0].answer(1)) === 'sent');
check(
  'second answer to the same question is refused',
  await denied(set(ref(pdb, `${base}/answers/q0/${players[0].pid}`), {c: 0, t: serverTimestamp()})),
);
check('player 1 answers', (await players[1].answer(0)) === 'sent');
// player 2 doesn't answer → host closes at the buzzer
await sleep(6200);
check('host revealed after the time limit', host.view.state.phase === 'reveal');
await sleep(300);
const r0 = players[0].view.result;
check('player 0 correct with 500–1000 points', !!r0?.last?.correct && r0.score >= 500 && r0.score <= 1000);
check('player 1 wrong, 0 points', players[1].view.result?.last?.correct === false && players[1].view.result?.score === 0);
check('player 2 no answer, 0 points', players[2].view.result?.last?.answered === false);
check('reveal counts', JSON.stringify(players[0].view.reveal?.counts) === JSON.stringify([1, 1, 0, 0]));
check(
  'answer after close is refused',
  await denied(set(ref(apps[2].db, `${base}/answers/q0/${players[2].pid}`), {c: 1, t: serverTimestamp()})),
);

// Late join is off → refused once the game started
const lateApp = openDatabase(backend, 'late');
let lateErr = '';
try {
  await new PlayerClient(lateApp.db, pin, newPlayerId(), 'Late').join();
} catch (e) {
  lateErr = (e as JoinFailed).code;
}
check('late join refused when turned off', lateErr === 'started');

// Remove a player
await host.kick(players[2].pid);
await sleep(1500);
check('removed player sees "kicked"', players[2].view.status === 'kicked');
check(
  'removed player cannot rejoin with the same id',
  await denied(
    update(ref(lateApp.db), {
      [`${base}/players/${players[2].pid}`]: {name: 'Cy2', joinedAt: serverTimestamp()},
      [`${base}/names/cy2`]: players[2].pid,
    }),
  ),
);

// All answered → closes early
await host.next(); // board
await host.next(); // question 1
await sleep(1200);
await Promise.all([players[0].answer(0), players[1].answer(0)]);
await sleep(600);
check('question closes early when everyone online has answered', host.view.state.phase === 'reveal');
check('streak bonus applied (2nd correct in a row = +100)', players[0].view.result?.last?.bonus === 100);

check('a player cannot delete a fresh game', await denied(set(ref(pdb, `games/${pin}`), null)));

await host.next(); // podium
await sleep(300);
check('phones reach podium', players[0].view.state?.phase === 'podium');
await host.destroy();
await sleep(1800);
check('phones see the game ended', players.slice(0, 2).every((p) => p.view.status === 'ended'));
const left = await get(ref(hostApp.db, `games/${pin}/meta`)).catch(() => null);
check('game data deleted', !left?.exists());

for (const a of [...apps, hostApp, dupApp, lateApp]) await deleteApp(a.app).catch(() => {});
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
