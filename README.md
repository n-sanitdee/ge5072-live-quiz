# GE5072 Live Quiz

A live classroom quiz for GE5072/GE072 Business English. The teacher runs the game on the projector; every student
plays on their own phone. There is no player limit beyond the database's 100 connections, and students don't
install anything or log in.

- Students: **https://n-sanitdee.github.io/ge5072-live-quiz/**
- Teacher (projector): **https://n-sanitdee.github.io/ge5072-live-quiz/#host**

**For the slide (Thai + English):**

> Scan the QR code or go to **n-sanitdee.github.io/ge5072-live-quiz**, enter the game PIN and a nickname (not your real name or student ID). · สแกน QR หรือเข้า **n-sanitdee.github.io/ge5072-live-quiz** ใส่รหัสเกม แล้วตั้งชื่อเล่น (ห้ามใช้ชื่อจริงหรือรหัสนักศึกษา)

---

## Host guide

**Before class:** open the teacher link on the projector laptop (bookmark it). Use Chrome, Edge or Safari, and
press ⛶ for full screen.

1. **Pick a question set.** The built-in *Pop Quiz Warm-Up (1/2026)* is ready. To use another set, click
   **Load a file** and choose a `.xlsx` in the Kahoot-style template (header on row 8, questions from row 9:
   question, answers 1–4, time limit, correct answer number) or a `.json` set. A loaded file stays in this browser
   only; phones get each question when it is shown, and the correct answer only after time is up.
2. **Settings (optional).** Reading time before answers open (default 5 s), streak bonus (default +100 per correct
   answer in a row, at most +500), and whether late students may join.
3. **Create game.** The lobby shows the web address, a 6-digit PIN and a QR code. Students scan the QR code (or
   type the address and the PIN), choose a nickname and appear on screen. Click a name to remove that player.
   **Lock** stops new players from joining.
4. **Start.** For each question: students read for a few seconds, then answer on their phones. The question
   closes when time is up or when everyone connected has answered. **Show answer now** closes it early;
   **Skip question** moves on without points.
5. The projector shows the correct answer and how many students chose each option. **Leaderboard** shows the top 5,
   then **Next question**. Space, Enter, → or a presentation clicker presses the gold button.
6. After the last question: **Final results** shows the podium (top 3) and the full ranking. Phones show each
   student's final rank. **End game** (bottom left) jumps to the final results at any time.
7. **Finish & delete game data** deletes the nicknames, answers and scores from the database.

**Players list:** 👥 at the top right shows who is connected (● connected, ○ phone asleep or offline) and lets
you remove a player during the game.

**If the projector browser closes or reloads:** open the teacher link again on the same laptop and click
**Resume game**. If the laptop is offline for a moment, the game waits for it.

**Data:** students give a nickname only (the join screen tells them not to use their real name or student ID and
refuses long numbers). Nothing else is collected. A game's data is deleted when you press **Finish & delete game
data**. Games that were never finished are deleted automatically after 3 hours.

**Scoring** (like Kahoot's "standard" points): wrong or no answer = 0 and the streak resets; correct =
`round(1000 × (1 − (response time ÷ time limit) ÷ 2))`, i.e. 500–1000 points, plus the streak bonus (+0 for the
first correct answer in a row, +100 for the 2nd, +200 for the 3rd … up to +500). Response times are measured with
the database server's clock, so a phone with a wrong clock can't gain or lose time.

---

## Question sets

Built-in sets live in [`src/sets/`](src/sets/) and are listed in [`src/sets/index.ts`](src/sets/index.ts).
**This repository is public: only add sets that are safe to publish.** Real quiz sets should be loaded from a
file on the host screen instead.

JSON format (answer numbers start at 1, like the spreadsheet; 2–4 answers; time 5–240 s):

```json
{
  "title": "My set",
  "questions": [
    {"q": "Which sentence is correct?", "answers": ["A", "B", "C", "D"], "correct": [2], "time": 20}
  ]
}
```

Convert a Kahoot-style spreadsheet: `node scripts/xlsx-to-json.ts quiz.xlsx src/sets/my-set.json "Set title"`.
The host screen's **Save this set as .json** button does the same in the browser.

---

## Limits

- **100 simultaneous connections** on Firebase's free Spark plan: one per student phone plus the projector.
  That is about 95 players at once across all games (the largest section has 56). The 101st phone can't connect
  until someone leaves; phones disconnect automatically when a game ends.
- Free plan storage (1 GB) and download (10 GB/month) are far above what a quiz uses (a 60-player game is well
  under 5 MB).
- Students need a reasonably recent browser (iOS 14+ Safari, Android Chrome 87+). Keep the phone screen on: the
  page asks the phone not to sleep, but a locked phone drops its connection (it rejoins when unlocked).
- Game PINs can be guessed, as in any PIN-based quiz. If someone unexpected joins, remove them and press **Lock**.

---

## Setup (one time, by the project owner)

The app runs on GitHub Pages; the live game state goes through a Firebase Realtime Database on the free Spark plan
(no credit card).

1. Go to <https://console.firebase.google.com>, sign in with your Google account and **Create a project**
   (e.g. `ge5072-live-quiz`; Google Analytics is not needed).
2. **Build → Realtime Database → Create database.** Location: **Singapore (asia-southeast1)**. Start in
   **locked mode**.
3. In the database's **Rules** tab, replace everything with the contents of
   [`database.rules.json`](database.rules.json) and click **Publish**.
4. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save.** (Only the host screen
   signs in, anonymously; students never sign in.)
5. **Project settings (⚙) → General → Your apps → Web (`</>`)**: register an app (no Firebase Hosting), then copy
   the `firebaseConfig` values into [`src/firebase-config.ts`](src/firebase-config.ts) and push. These values are
   public by design; the rules control access.

Stay on the Spark plan: if a limit is ever reached the database refuses new connections instead of charging.

---

## How it works

- **Static site** (React + Vite) on GitHub Pages, deployed by [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
  on every push to `main`.
- **Firebase Realtime Database** relays the game. The host browser runs the timer and the scoring
  ([`src/game/host.ts`](src/game/host.ts), [`src/game/scoring.ts`](src/game/scoring.ts)); phones run
  [`src/game/player.ts`](src/game/player.ts).
- **Database layout** (`games/<PIN>/…`): `pub` (current phase, current question without its answer, results chart
  after the reveal; readable by phones), `host` (the question set with correct answers and the scores; host only),
  `players/<id>` (nickname), `answers/q<n>/<id>` (choice + server timestamp), `results/<id>` (each phone's score
  and rank). `index/<PIN>` holds creation times for the clean-up.
- **Security rules** ([`database.rules.json`](database.rules.json)): only the host that created a game can change
  it, read the answers or see the correct answers. A phone can only write its own answer, once, to the current
  question, between the moment answers unlock and the time limit, and the database stamps the time itself. A player
  id is a 20-character random secret kept on that phone, so nobody else can answer for it. Nicknames are unique
  within a game.
- **Clean-up:** the host deletes a game when it finishes. [`.github/workflows/cleanup.yml`](.github/workflows/cleanup.yml)
  runs every hour and deletes games older than 3 hours (GitHub pauses scheduled workflows after 60 days without a
  commit; the host screen also clears old games whenever it opens).

## Development

```bash
npm install
npm run emulators      # local Firebase emulators (needs Java 21+); keep running
npm run dev:emu        # app on http://localhost:5173 (students) and http://localhost:5173/#host
node tests/rules-test.ts                    # security-rules checks
node tests/load-test.ts --players 60        # 60 simulated phones play the whole warm-up set
node tests/load-test.ts --players 60 --live # the same against the real Firebase project
```
