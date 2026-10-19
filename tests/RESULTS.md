# Test results

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

- The real Firebase project (needs the project to exist): 100-connection limit, real latency from Thailand.
- Real phones on campus Wi-Fi and Thai mobile data (WebKit/Chromium emulation is not a real iPhone/Android).
