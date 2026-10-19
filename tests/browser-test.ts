// End-to-end check of the real screens: projector (Chromium 1920×1080 and 1280×720), an Android-sized Chrome
// phone and an iPhone-sized WebKit phone (375 px wide) whose clock is 3 minutes slow, plus 25 scripted phones.
// Saves screenshots of every phase to tests/out/screens/.
//
//   npm run emulators   # terminal 1
//   npm run dev:emu     # terminal 2
//   node tests/browser-test.ts
import {mkdirSync} from 'node:fs';
import {type Page, chromium, devices, webkit} from 'playwright';
import {EMULATOR_CONFIG, openDatabase} from '../src/game/fb.ts';
import {PlayerClient, newPlayerId} from '../src/game/player.ts';
import type {Answer, PlayerResult, PubState} from '../src/game/types.ts';

const BASE = 'http://localhost:5173/';
const OUT = 'tests/out/screens';
const DB = 'http://127.0.0.1:9000';
const NS = 'ns=demo-livequiz-default-rtdb';
const SKEW_MS = -3 * 60 * 1000;
mkdirSync(OUT, {recursive: true});

let failures = 0;
const check = (label: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` (${extra})` : ''}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const admin = async (path: string) =>
  (await fetch(`${DB}/${path}.json?${NS}`, {headers: {Authorization: 'Bearer owner'}})).json();
const shot = (page: Page, name: string) => page.screenshot({path: `${OUT}/${name}.png`});
async function noHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

// ---------------------------------------------------------------- browsers
const cr = await chromium.launch();
const wk = await webkit.launch();
const hostCtx = await cr.newContext({viewport: {width: 1920, height: 1080}});
const host = await hostCtx.newPage();
const android = await (
  await cr.newContext({...devices['Pixel 7'], viewport: {width: 375, height: 740}, deviceScaleFactor: 2})
).newPage();
const iosCtx = await wk.newContext({...devices['iPhone SE'], viewport: {width: 375, height: 667}});
await iosCtx.clock.install({time: Date.now() + SKEW_MS});
await iosCtx.clock.resume();
const ios = await iosCtx.newPage();
for (const p of [host, android, ios]) p.on('pageerror', (e) => check(`no page error`, false, e.message));

// ---------------------------------------------------------------- host creates a game with the long-text set
await host.goto(`${BASE}#host`);
await host.waitForSelector('text=Create game');
await host.setInputFiles('input[type=file]', 'tests/fixtures/long-text-set.json');
await host.waitForSelector('text=Layout test (long texts)');
await host.fill('.field:has-text("Reading time") input', '3');
await shot(host, '01-host-setup');
await host.click('text=Create game');
await host.waitForSelector('.pin');
const pin = (await host.textContent('.pin'))!.replace(/\s/g, '');
check('game created', /^\d{6}$/.test(pin), pin);

// ---------------------------------------------------------------- phones join
await android.goto(BASE);
await shot(android, '02-phone-pin-chrome');
await android.fill('#pin', pin);
await android.click('button:has-text("Enter")');
await android.waitForSelector('#nick');
await android.fill('#nick', '1234567 Ploy');
await android.click('button:has-text("Join")');
await android.waitForSelector('text=No long numbers');
check('a student-ID-like nickname is refused', true);
await android.fill('#nick', 'Ploy');
await shot(android, '03-phone-nickname-chrome');
await android.click('button:has-text("Join")');
await android.waitForSelector("text=You're in!");

await ios.goto(`${BASE}?pin=${pin}`); // as from the QR code
await ios.waitForSelector('#nick');
await ios.fill('#nick', 'ploy');
await ios.click('button:has-text("Join")');
await ios.waitForSelector('text=That nickname is taken');
check('duplicate nickname refused on the phone', true);
await ios.fill('#nick', 'น้องแพร');
await shot(ios, '04-phone-nickname-safari');
await ios.click('button:has-text("Join")');
await ios.waitForSelector("text=You're in!");
await shot(ios, '05-phone-lobby-safari');
check('phones have no horizontal scroll (lobby)', (await noHorizontalScroll(android)) && (await noHorizontalScroll(ios)));

// 25 scripted phones so the screens look like a class
const bots: PlayerClient[] = [];
const names = ['Mint', 'Bank', 'Fern', 'Ice', 'Earth', 'Pim', 'Toey', 'Beam', 'Nut', 'Aom', 'Boss', 'Jane', 'Kla', 'Mook', 'Nan', 'Oat', 'Palm', 'Q', 'Rin', 'Sun', 'Tan', 'Up', 'View', 'Win', 'Yok'];
await Promise.all(
  names.map(async (n, k) => {
    const {db} = openDatabase({config: EMULATOR_CONFIG, emulatorHost: '127.0.0.1'}, `bot${k}`);
    const c = new PlayerClient(db, pin, newPlayerId(), n);
    await c.join();
    bots.push(c);
    const seen = new Set<number>();
    c.subscribe((v) => {
      const s = v.state;
      if (s?.phase !== 'question' || seen.has(s.i)) return;
      seen.add(s.i);
      const delay = Math.max(0, s.startAt - c.serverNow()) + 800 + Math.random() * 6000;
      setTimeout(() => void c.answer(Math.floor(Math.random() * (s.i === 1 ? 2 : 4))), delay);
    });
  }),
);
await sleep(1000);
check('host lobby lists 27 players', (await host.locator('.names .name').count()) === 27);
await shot(host, '06-host-lobby-1920');
await host.setViewportSize({width: 1280, height: 720});
await shot(host, '07-host-lobby-1280');
await host.setViewportSize({width: 1920, height: 1080});

// ---------------------------------------------------------------- play the three questions
const iosPid = (await ios.evaluate(() => JSON.parse(localStorage.getItem('lq:player')!).pid)) as string;
// The correct answer is the first slot in all three fixture questions.
const choices = [
  {android: 0, ios: 1}, // Q1: android right, ios wrong
  {android: 1, ios: 0}, // Q2: android wrong, ios right
  {android: 0, ios: 0}, // Q3: both right (ios: 2 in a row → +100 streak bonus)
];
for (let i = 0; i < 3; i++) {
  await host.click(i === 0 ? 'button:has-text("Start")' : 'button:has-text("Next question")');
  await ios.waitForSelector('text=Get ready', {timeout: 15000}).catch(async (e) => {
    await Promise.all([shot(host, 'ERR-host'), shot(ios, 'ERR-ios'), shot(android, 'ERR-android')]);
    console.log('IOS TEXT:', (await ios.textContent('body'))?.slice(0, 300));
    console.log('ANDROID TEXT:', (await android.textContent('body'))?.slice(0, 300));
    console.log('IOS offset/now:', await ios.evaluate(() => Date.now()), Date.now());
    throw e;
  });
  await shot(host, `1${i}a-host-preview`);
  await shot(ios, `1${i}a-phone-preview-safari`);
  await ios.waitForSelector('.p-tiles:not(.locked) .tile');
  await android.waitForSelector('.p-tiles:not(.locked) .tile');
  await sleep(1200);
  // Timer sync: the slow-clock phone must show the same seconds as the projector.
  const diffs: number[] = [];
  for (let n = 0; n < 6; n++) {
    const [h, p] = await Promise.all([host.textContent('.clock'), ios.textContent('.p-left')]);
    diffs.push(Math.abs(Number(h) - Number(p)));
    await sleep(370);
  }
  check(`Q${i + 1}: slow-clock phone countdown matches the projector`, Math.max(...diffs) <= 1 && diffs.filter((d) => d === 0).length >= 4, `diffs ${diffs.join(',')}`);
  await shot(host, `1${i}b-host-question-1920`);
  if (i === 0) {
    await host.setViewportSize({width: 1280, height: 720});
    await shot(host, `1${i}b-host-question-1280`);
    await host.setViewportSize({width: 1920, height: 1080});
  }
  await shot(android, `1${i}b-phone-question-chrome`);
  await shot(ios, `1${i}b-phone-question-safari`);
  check(`Q${i + 1}: phones have no horizontal scroll`, (await noHorizontalScroll(android)) && (await noHorizontalScroll(ios)));
  const tileFits = await ios.evaluate(() =>
    [...document.querySelectorAll('.p-tiles .tile')].every((t) => t.getBoundingClientRect().bottom <= window.innerHeight + 1),
  );
  check(`Q${i + 1}: all answer tiles fit on a 375×667 screen`, tileFits);
  await android.locator('.p-tiles .tile').nth(choices[i].android).click();
  await ios.locator('.p-tiles .tile').nth(choices[i].ios).click();
  await ios.waitForSelector('text=Answer sent');
  await shot(ios, `1${i}c-phone-sent-safari`);
  await host.click('button:has-text("Show answer now")');
  await ios.waitForSelector('.result');
  await android.waitForSelector('.result');
  await sleep(700);
  await shot(host, `1${i}d-host-reveal-1920`);
  if (i === 0) {
    await host.setViewportSize({width: 1280, height: 720});
    await shot(host, `1${i}d-host-reveal-1280`);
    await host.setViewportSize({width: 1920, height: 1080});
  }
  await shot(android, `1${i}d-phone-result-chrome`);
  await shot(ios, `1${i}d-phone-result-safari`);

  // Score check for the slow-clock phone, from the server timestamps.
  const state = (await admin(`games/${pin}/pub/state`)) as PubState;
  const ans = (await admin(`games/${pin}/answers/q${i}/${iosPid}`)) as Answer;
  const res = (await admin(`games/${pin}/results/${iosPid}`)) as PlayerResult;
  const correct = ans.c === 0;
  const base = correct ? Math.round(1000 * (1 - Math.min(Math.max(ans.t - state.startAt, 0), state.limitMs) / state.limitMs / 2)) : 0;
  const bonus = i === 2 ? 100 : 0;
  check(
    `Q${i + 1}: slow-clock phone scored by server time`,
    res.last?.pts === (correct ? base + bonus : 0),
    `answered ${((ans.t - state.startAt) / 1000).toFixed(2)}s after unlock, got ${res.last?.pts}, expected ${correct ? base + bonus : 0}`,
  );
  const shown = await ios.textContent('.pts');
  check(`Q${i + 1}: phone shows the points`, shown === `+${(res.last?.pts ?? 0).toLocaleString()}`, `${shown}`);

  await host.click(i === 2 ? 'button:has-text("Final results")' : 'button:has-text("Leaderboard")');
  if (i < 2) {
    await host.waitForSelector('.board li');
    await sleep(500);
    await shot(host, `1${i}e-host-leaderboard`);
    await shot(ios, `1${i}e-phone-standing-safari`);
  }
}

// ---------------------------------------------------------------- podium and clean-up
await host.waitForSelector('.podium');
await ios.waitForSelector('text=Final rank');
await sleep(2200);
await shot(host, '20-host-podium-1920');
await host.setViewportSize({width: 1280, height: 720});
await shot(host, '21-host-podium-1280');
await shot(ios, '22-phone-final-safari');
await shot(android, '23-phone-final-chrome');
await host.click('button:has-text("Finish & delete game data")');
await host.waitForSelector('text=Create game');
await ios.waitForSelector('text=Join another game', {timeout: 8000}).then(
  () => check('phones see the game ended', true),
  () => check('phones see the game ended', false),
);
check('game data deleted from the database', (await admin(`games/${pin}`)) === null);
check('PIN index entry deleted', (await admin(`index/${pin}`)) === null);
await shot(ios, '24-phone-ended-safari');

for (const b of bots) b.stop({disconnect: true});
await cr.close();
await wk.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
