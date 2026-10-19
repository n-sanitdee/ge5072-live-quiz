# Test results

## 19 Oct 2026 — real Firebase project (`ge5072-live-quiz`, Singapore), run from a home connection in Thailand

- **Security rules** (`node tests/rules-test.ts --live`): 36/36 passed, so the rules published in the console
  are the tested ones.
- **Load test** (`node tests/load-test.ts --players 60 --live`), 60 players × the 12-question warm-up set
  (61 database connections): **PASS, no issues.**

| | |
|---|---|
| Joined | 60/60 (burst over 8 s; join p50 426 ms, p95 596 ms) |
| Answers acknowledged | 700, all present when the question was scored; 0 lost, 0 late |
| Scores | every player, every question matched an independent implementation of the formula |
| Question publish → phone | p50 116 ms, p95 277 ms |
| Answer sent → confirmed | p50 76 ms, p95 142 ms |
| Question close → points on phone | p50 129 ms, p95 478 ms |
| Phone vs projector clock estimate | p50 14 ms, max 61 ms apart (the countdowns agree to well under a second) |
| Disruptions | 5 phones lost their connection 3 times each for 2–6 s; 2 phones reloaded mid-game and rejoined with their score |
| End | 60/60 phones reached the podium and saw "game ended"; game data deleted; stale-game clean-up query allowed |

- **Live site** (n-sanitdee.github.io/ge5072-live-quiz, built by GitHub Actions): host screen → game → a phone
  joined from the QR link → question → +787 points, bar chart and correct answer on the projector → podium →
  "Finish & delete" → phone shows the game-over screen.

## 19 Oct 2026 — local Firebase emulators

Commands: `node tests/rules-test.ts`, `node tests/load-test.ts --players 60`, `node tests/browser-test.ts`.

### Security rules (`tests/rules-test.ts`) — 36/36 passed

Players cannot read the correct answers, other players' answers or the player list; cannot change the game state,
write scores, list or delete games; cannot answer in the lobby, before answers unlock, with a fake timestamp, for a
made-up player id, for the wrong question, twice, or after the question closed. Duplicate nicknames ("a nn" vs
"Ann") are refused, late joining can be switched off, a removed player cannot rejoin with the same id, and the
host's own writes are also checked by the rules.

### Load test (`tests/load-test.ts`) — 60 players, full 12-question warm-up set: PASS

| | |
|---|---|
| Joined | 60/60 (burst over 8 s; join p95 14 ms) |
| Answers acknowledged | 700, all present in the database when the question was scored |
| Answers lost | 0 |
| Late answers | 1, from a phone whose connection the test cut mid-question; refused and scored 0 (correct behaviour) |
| Scores | every player, every question matched an independent implementation of the formula (incl. streak bonus) |
| Question publish → phone | p50 10 ms, p95 24 ms (max 3.3 s = a phone reconnecting after a cut) |
| Question close → points on phone | p50 18 ms, p95 30 ms |
| Phone vs projector clock estimate | ≤ 1 ms apart |
| Disruptions | 5 phones lost their connection 3 times each for 2–6 s; 2 phones reloaded the page mid-game and rejoined with their score |
| End | 60/60 phones reached the podium and saw "game ended"; game data deleted; stale-game clean-up query allowed |

On the emulator everything runs on one machine, so these latencies show the app adds almost nothing; real network
latency (Thailand → Singapore) comes on top. Re-run with `--live` against the real project.

### Browser test (`tests/browser-test.ts`) — 23/23 passed

Projector in Chromium at 1920×1080 and 1280×720; phones: Chrome (Android, 375×740) and WebKit/Safari (iPhone SE,
375×667) **with its clock set 3 minutes slow**; plus 25 scripted phones. Checked: student-ID-like and duplicate
nicknames refused; no horizontal scrolling; all four 75-character answers fit on a 375×667 screen; the slow-clock
phone's countdown matched the projector (same second in 17 of 18 samples, 1 s apart at a boundary in the other);
its points matched the formula computed from server timestamps (0 / 862 / 961 incl. +100 streak bonus); podium,
"Finish & delete" and the phones' "game ended" screen; game data and PIN index deleted.

### Not yet verified

- Real phones on campus Wi-Fi and Thai mobile data (the live test ran from one home connection; WebKit/Chromium
  emulation is not a real iPhone/Android).
- More than 61 connections at once on the real project (the free plan allows 100).
