import {type FormEvent, type ReactNode, useEffect, useRef, useState} from 'react';
import {backend, configured} from '../backend.ts';
import {openDatabase} from '../game/fb.ts';
import {
  type JoinError,
  JoinFailed,
  PlayerClient,
  type PlayerView,
  checkGame,
  checkNickname,
  newPlayerId,
} from '../game/player.ts';
import {APP_NAME, Bi, Shape, Spinner, ordinal, useTicker} from '../ui/common.tsx';

const SAVED = 'lq:player';
type Saved = {pin: string; pid: string; name: string};

function loadSaved(): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(SAVED) ?? 'null');
  } catch {
    return null;
  }
}
function save(s: Saved | null) {
  try {
    if (s) localStorage.setItem(SAVED, JSON.stringify(s));
    else localStorage.removeItem(SAVED);
  } catch {
    // Private mode: rejoining after a reload just won't be automatic.
  }
}

const JOIN_ERRORS: Record<JoinError, [string, string]> = {
  'not-found': ['Game not found — check the PIN.', 'ไม่พบเกมนี้ ตรวจสอบรหัสเกมอีกครั้ง'],
  locked: ['This game is locked — no new players.', 'เกมนี้ปิดรับผู้เล่นใหม่แล้ว'],
  started: ['This game has already started.', 'เกมเริ่มไปแล้ว เข้าร่วมไม่ได้'],
  ended: ['This game has finished.', 'เกมนี้จบไปแล้ว'],
  taken: ['That nickname is taken — try another one.', 'มีคนใช้ชื่อนี้แล้ว ลองชื่ออื่น'],
  network: ['No connection — check your internet and try again.', 'เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'],
};

const NAME_ERRORS: Record<string, [string, string]> = {
  empty: ['Type a nickname.', 'กรุณาใส่ชื่อเล่น'],
  long: ['15 characters at most.', 'ไม่เกิน 15 ตัวอักษร'],
  chars: ['Use Thai or English letters, numbers, space, - or _ only.', 'ใช้ได้เฉพาะตัวอักษรไทย/อังกฤษ ตัวเลข เว้นวรรค - และ _'],
  digits: ["No long numbers — don't use your student ID.", 'ห้ามใส่ตัวเลขยาว ๆ และห้ามใช้รหัสนักศึกษา'],
};

let db: ReturnType<typeof openDatabase>['db'] | null = null;
function getDb() {
  db ??= openDatabase(backend).db;
  return db;
}

/** Keep the phone screen on during the game (a sleeping phone drops its connection). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: {release: () => Promise<void>} | null = null;
    const get = () => {
      if (document.visibilityState !== 'visible') return;
      (navigator as unknown as {wakeLock: {request: (t: 'screen') => Promise<typeof lock>}}).wakeLock
        .request('screen')
        .then((l) => (lock = l))
        .catch(() => {});
    };
    get();
    document.addEventListener('visibilitychange', get);
    return () => {
      document.removeEventListener('visibilitychange', get);
      lock?.release().catch(() => {});
    };
  }, [active]);
}

export function PlayerApp() {
  const params = new URLSearchParams(location.search);
  const urlPin = (params.get('pin') ?? '').replace(/\D/g, '').slice(0, 6);
  const [step, setStep] = useState<'resume' | 'pin' | 'name' | 'game'>(() => {
    const s = loadSaved();
    return s && (!urlPin || urlPin === s.pin) ? 'resume' : urlPin ? 'name' : 'pin';
  });
  const [pin, setPin] = useState(urlPin);
  const [name, setName] = useState('');
  const [error, setError] = useState<[string, string] | null>(null);
  const [busy, setBusy] = useState(false);
  const [client, setClient] = useState<PlayerClient | null>(null);
  const resumed = useRef(false);

  // Coming back after a reload: rejoin with the same player id (keeps the score).
  useEffect(() => {
    if (step !== 'resume' || resumed.current) return;
    resumed.current = true;
    const s = loadSaved()!;
    const c = new PlayerClient(getDb(), s.pin, s.pid, s.name);
    c.join()
      .then(() => {
        setClient(c);
        setStep('game');
      })
      .catch(() => {
        save(null);
        c.stop();
        setPin(urlPin || '');
        setStep(urlPin ? 'name' : 'pin');
      });
  }, [step, urlPin]);

  // A PIN that came in the QR code still has to be checked once.
  useEffect(() => {
    if (step === 'name' && urlPin && pin === urlPin && !error) {
      checkGame(getDb(), urlPin).then((why) => {
        if (why) {
          setError(JOIN_ERRORS[why]);
          setStep('pin');
        }
      });
    }
  }, []);

  async function submitPin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const why = await checkGame(getDb(), pin);
    setBusy(false);
    if (why) setError(JOIN_ERRORS[why]);
    else setStep('name');
  }

  async function submitName(e: FormEvent) {
    e.preventDefault();
    const checked = checkNickname(name);
    if (checked.error) return setError(NAME_ERRORS[checked.error]);
    setError(null);
    setBusy(true);
    const c = new PlayerClient(getDb(), pin, newPlayerId(), checked.name);
    try {
      await c.join();
      save({pin, pid: c.pid, name: c.name});
      setClient(c);
      setStep('game');
    } catch (err) {
      c.stop();
      const code = err instanceof JoinFailed ? err.code : 'network';
      setError(JOIN_ERRORS[code]);
      if (code !== 'taken' && code !== 'network') setStep('pin');
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <div className="screen center pad">
        <h1 className="brand">{APP_NAME}</h1>
        <p>Not set up yet: the Firebase config is missing (see README).</p>
      </div>
    );
  }

  if (step === 'game' && client) return <Game client={client} />;

  if (step === 'resume') {
    return (
      <div className="screen center">
        <Spinner />
        <Bi en="Rejoining your game…" th="กำลังกลับเข้าเกม…" />
      </div>
    );
  }

  return (
    <div className="screen join">
      <h1 className="brand">{APP_NAME}</h1>
      {step === 'pin' ? (
        <form className="card" onSubmit={submitPin}>
          <label htmlFor="pin">
            <Bi en="Game PIN" th="รหัสเกม" />
          </label>
          <input
            id="pin"
            className="big-input"
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="123456"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoFocus
          />
          {error && <ErrorBox msg={error} />}
          <button className="btn primary block" disabled={pin.length !== 6 || busy}>
            {busy ? <Spinner /> : <Bi en="Enter" th="ถัดไป" />}
          </button>
        </form>
      ) : (
        <form className="card" onSubmit={submitName}>
          <div className="pin-chip">
            PIN {pin}{' '}
            <button
              type="button"
              className="link"
              onClick={() => {
                setError(null);
                setStep('pin');
              }}
            >
              <Bi en="change" th="เปลี่ยน" />
            </button>
          </div>
          <label htmlFor="nick">
            <Bi en="Nickname" th="ชื่อเล่น" />
          </label>
          <input
            id="nick"
            className="big-input"
            autoComplete="off"
            autoCapitalize="words"
            maxLength={15}
            placeholder="e.g. Ploy / พลอย"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <p className="notice">
            <Bi
              en="Use a nickname only — not your real name or student ID."
              th="ใช้ชื่อเล่นหรือนามแฝงเท่านั้น ห้ามใช้ชื่อจริงหรือรหัสนักศึกษา"
            />
          </p>
          {error && <ErrorBox msg={error} />}
          <button className="btn primary block" disabled={!name.trim() || busy}>
            {busy ? <Spinner /> : <Bi en="Join" th="เข้าร่วม" />}
          </button>
          <p className="fine">
            <Bi
              en="Your nickname and answers are deleted when the game ends."
              th="ชื่อเล่นและคำตอบจะถูกลบเมื่อจบเกม"
            />
          </p>
        </form>
      )}
    </div>
  );
}

function ErrorBox({msg}: {msg: [string, string]}) {
  return (
    <div className="error" role="alert">
      <Bi en={msg[0]} th={msg[1]} />
    </div>
  );
}

function usePlayerView(client: PlayerClient): PlayerView {
  const [view, setView] = useState(client.view);
  useEffect(() => client.subscribe(setView), [client]);
  return view;
}

function Game({client}: {client: PlayerClient}) {
  const view = usePlayerView(client);
  const s = view.state;
  useWakeLock(view.status === 'playing');
  useTicker(view.status === 'playing' && (s?.phase === 'question' || s?.phase === 'closing'), 100);

  useEffect(() => {
    if (view.status !== 'playing') save(null);
  }, [view.status]);

  const header = (
    <header className="p-head">
      <span className="p-name">{client.name}</span>
      {view.result && <span className="p-score">{view.result.score.toLocaleString()}</span>}
    </header>
  );
  const banner = !view.connected && view.status === 'playing' && (
    <div className="offline" role="status">
      <Bi en="Reconnecting…" th="กำลังเชื่อมต่อใหม่…" />
    </div>
  );

  let body;
  if (view.status === 'kicked') {
    body = (
      <Center>
        <Bi className="h2" en="The host removed you from this game." th="ผู้สอนนำคุณออกจากเกมนี้" />
        <PlayAgain />
      </Center>
    );
  } else if (view.status === 'ended' || s?.phase === 'podium') {
    body = <Final view={view} ended={view.status === 'ended'} />;
  } else if (!s) {
    body = <Center><Spinner /></Center>;
  } else if (s.phase === 'lobby') {
    body = (
      <Center>
        <div className="big-emoji" aria-hidden>✅</div>
        <Bi className="h2" en="You're in!" th="เข้าเกมแล้ว!" />
        <Bi en="See your nickname on the screen?" th="เห็นชื่อตัวเองบนจอไหม?" />
        <div className="waiting">
          <Spinner />
          <Bi en="Waiting for the game to start…" th="รอผู้สอนเริ่มเกม…" />
        </div>
      </Center>
    );
  } else if (s.phase === 'question' || s.phase === 'closing') {
    body = <Question client={client} view={view} />;
  } else if (s.phase === 'reveal') {
    body = <Result view={view} />;
  } else {
    body = <Standing view={view} />;
  }

  return (
    <div className="screen player">
      {header}
      {banner}
      <main className="p-body">{body}</main>
    </div>
  );
}

function Center({children}: {children: ReactNode}) {
  return <div className="p-center">{children}</div>;
}

function PlayAgain() {
  return (
    <button className="btn ghost" onClick={() => (location.href = location.pathname)}>
      <Bi en="Join another game" th="เข้าเกมอื่น" />
    </button>
  );
}

function Question({client, view}: {client: PlayerClient; view: PlayerView}) {
  const s = view.state!;
  const q = view.question && view.question.i === s.i ? view.question : undefined;
  const now = client.serverNow();
  const locked = now < s.startAt;
  const left = Math.max(0, s.startAt + s.limitMs - now);
  const over = s.phase === 'closing' || left <= 0;
  const mine = view.answer && view.answer.i === s.i ? view.answer : undefined;
  const counter = (
    <div className="p-qhead">
      <Bi en={`Question ${s.i + 1} of ${s.total}`} th={`ข้อ ${s.i + 1} จาก ${s.total}`} />
      {!locked && !over && <span className="p-left">{Math.ceil(left / 1000)}</span>}
    </div>
  );
  const bar = !locked && (
    <div className="timebar" aria-hidden>
      <div style={{width: `${Math.min(100, (left / s.limitMs) * 100)}%`}} />
    </div>
  );

  if (mine) {
    return (
      <>
        {counter}
        {bar}
        <Center>
          <div className={`chosen tile t${mine.c}`}>
            <Shape k={mine.c} size={44} />
            <span>{q?.answers[mine.c]}</span>
          </div>
          {mine.status === 'sending' && <Bi className="h2" en="Sending…" th="กำลังส่ง…" />}
          {mine.status === 'sent' && (
            <>
              <Bi className="h2" en="Answer sent" th="ส่งคำตอบแล้ว" />
              <div className="waiting">
                <Spinner />
                <Bi en="Waiting for the others…" th="รอเพื่อน ๆ ตอบ…" />
              </div>
            </>
          )}
          {mine.status === 'late' && <Bi className="h2" en="Too late — time was up." th="ช้าไป หมดเวลาแล้ว" />}
        </Center>
      </>
    );
  }
  if (over) {
    return (
      <>
        {counter}
        <Center>
          <div className="big-emoji" aria-hidden>⏰</div>
          <Bi className="h2" en="Time's up!" th="หมดเวลา!" />
        </Center>
      </>
    );
  }
  return (
    <>
      {counter}
      {bar}
      {q && <p className="p-question">{q.q}</p>}
      {locked && (
        <div className="get-ready">
          <Bi en="Get ready…" th="เตรียมตัว…" /> <b>{Math.ceil((s.startAt - now) / 1000)}</b>
        </div>
      )}
      <div className={`p-tiles ${locked ? 'locked' : ''}`}>
        {(q?.answers ?? ['', '', '', '']).map((a, k) =>
          q && !a ? null : (
            <button
              key={k}
              className={`tile t${k}`}
              disabled={locked}
              onClick={() => {
                if (!client.canAnswer()) return;
                if ('vibrate' in navigator) navigator.vibrate?.(30);
                void client.answer(k);
              }}
            >
              <Shape k={k} size={34} />
              <span>{a}</span>
            </button>
          ),
        )}
      </div>
    </>
  );
}

function RankLine({view}: {view: PlayerView}) {
  const r = view.result;
  if (!r) return null;
  return (
    <div className="rankline">
      <Bi
        className="h3"
        en={`You're in ${ordinal(r.rank)} place of ${r.of}`}
        th={`คุณอยู่อันดับที่ ${r.rank} จาก ${r.of} คน`}
      />
      {r.rank === 1 ? (
        <Bi en="You're in the lead!" th="คุณนำอยู่!" />
      ) : (
        r.gap > 0 && (
          <Bi
            en={`${r.gap.toLocaleString()} points behind the next player`}
            th={`ตามหลังอันดับก่อนหน้า ${r.gap.toLocaleString()} คะแนน`}
          />
        )
      )}
    </div>
  );
}

function Result({view}: {view: PlayerView}) {
  const s = view.state!;
  const last = view.result?.last && view.result.last.i === s.i ? view.result.last : undefined;
  const reveal = view.reveal && view.reveal.i === s.i ? view.reveal : undefined;
  const q = view.question && view.question.i === s.i ? view.question : undefined;
  if (!last) {
    return (
      <Center>
        <Bi className="h2" en="Look at the screen" th="ดูเฉลยบนจอ" />
        <Bi en="You'll be scored from your next answer." th="เริ่มนับคะแนนตั้งแต่ข้อถัดไป" />
      </Center>
    );
  }
  const right = reveal && q ? reveal.correct.map((k) => q.answers[k]).join(' / ') : '';
  return (
    <div className={`result ${last.correct ? 'good' : 'bad'}`}>
      <div className="big-emoji" aria-hidden>{last.correct ? '✔' : '✖'}</div>
      {last.correct ? (
        <Bi className="h1" en="Correct" th="ถูกต้อง!" />
      ) : last.answered ? (
        <Bi className="h1" en="Incorrect" th="ผิด" />
      ) : (
        <Bi className="h1" en="No answer" th="ไม่ได้ตอบ" />
      )}
      <div className="pts">+{last.pts.toLocaleString()}</div>
      {last.correct && view.result!.streak > 1 && (
        <div className="streak">
          <Bi
            en={`🔥 Answer streak ${view.result!.streak}${last.bonus ? ` (+${last.bonus} bonus)` : ''}`}
            th={`ตอบถูกติดกัน ${view.result!.streak} ข้อ${last.bonus ? ` (โบนัส +${last.bonus})` : ''}`}
          />
        </div>
      )}
      {!last.correct && right && (
        <div className="right-answer">
          <Bi en="Correct answer:" th="คำตอบที่ถูก:" /> <b>{right}</b>
        </div>
      )}
      <RankLine view={view} />
    </div>
  );
}

function Standing({view}: {view: PlayerView}) {
  return (
    <Center>
      {view.result ? (
        <>
          <div className="p-bigrank">{ordinal(view.result.rank)}</div>
          <RankLine view={view} />
          <div className="score-line">
            <Bi en={`${view.result.score.toLocaleString()} points`} th={`${view.result.score.toLocaleString()} คะแนน`} />
          </div>
        </>
      ) : (
        <Bi className="h2" en="Look at the screen" th="ดูอันดับบนจอ" />
      )}
      <div className="waiting">
        <Spinner />
        <Bi en="Next question coming up…" th="รอข้อถัดไป…" />
      </div>
    </Center>
  );
}

function Final({view, ended}: {view: PlayerView; ended: boolean}) {
  const r = view.result;
  return (
    <Center>
      {r ? (
        <>
          <Bi className="h3" en="Final rank" th="อันดับสุดท้าย" />
          <div className="p-bigrank">{ordinal(r.rank)}</div>
          <Bi en={`of ${r.of} players · ${r.score.toLocaleString()} points`} th={`จาก ${r.of} คน · ${r.score.toLocaleString()} คะแนน`} />
        </>
      ) : (
        <Bi className="h2" en="The game has ended." th="เกมจบแล้ว" />
      )}
      <Bi className="h2" en="Thanks for playing!" th="ขอบคุณที่ร่วมเล่น!" />
      {ended && <PlayAgain />}
    </Center>
  );
}
