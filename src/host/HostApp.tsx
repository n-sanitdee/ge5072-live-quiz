import {type ReactNode, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {onValue, ref} from 'firebase/database';
import {backend, configured} from '../backend.ts';
import {openDatabase, signInHost} from '../game/fb.ts';
import {HostEngine, type HostView} from '../game/host.ts';
import {parseSetJson, parseSetXlsx, toFileJson} from '../game/sets.ts';
import {DEFAULT_SETTINGS, type QuestionSet, type Settings} from '../game/types.ts';
import {BUILT_IN_SETS} from '../sets/index.ts';
import {APP_NAME, Bi, Shape, Spinner, ordinal, useTicker} from '../ui/common.tsx';
import {Qr} from '../ui/Qr.tsx';

const HOST_KEY = 'lq:host';
const CUSTOM_KEY = 'lq:customSet';
const SETTINGS_KEY = 'lq:settings';

function readLocal<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
function writeLocal(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // ignore (private window)
  }
}

const {app, db} = openDatabase(backend, 'host');

function joinUrl(pin?: string) {
  const base = `${location.origin}${location.pathname}`;
  return pin ? `${base}?pin=${pin}` : base;
}

/** What students type: no https://, no trailing slash. */
function shortUrl() {
  return joinUrl().replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export default function HostApp() {
  const [uid, setUid] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [engine, setEngine] = useState<HostEngine | null>(null);
  const [resumePin, setResumePin] = useState<string | null>(null);

  useEffect(() => {
    document.title = `Host · ${APP_NAME}`;
    if (!configured) return;
    signInHost(app, backend)
      .then(async (u) => {
        setUid(u);
        const offset = await new Promise<number>((resolve) => {
          const off = onValue(ref(db, '.info/serverTimeOffset'), (s) => {
            off();
            resolve(s.val() ?? 0);
          });
        });
        HostEngine.cleanupStale(db, Date.now() + offset).catch(() => {});
        const saved = readLocal<{pin: string}>(HOST_KEY);
        if (saved?.pin) setResumePin(saved.pin);
      })
      .catch((e) => {
        const code = String(e?.code ?? e);
        setFatal(
          code.includes('operation-not-allowed') || code.includes('admin-restricted')
            ? 'Anonymous sign-in is turned off for this Firebase project. In the Firebase console: Authentication → Sign-in method → Anonymous → Enable.'
            : `Could not connect to Firebase (${code}). Check the internet connection and reload.`,
        );
      });
  }, []);

  if (!configured) {
    return (
      <div className="screen center pad">
        <h1 className="brand">{APP_NAME}</h1>
        <p>Firebase is not configured yet. Fill in src/firebase-config.ts (see README → Setup).</p>
      </div>
    );
  }
  if (fatal) {
    return (
      <div className="screen center pad">
        <h1 className="brand">{APP_NAME}</h1>
        <div className="error">{fatal}</div>
      </div>
    );
  }
  if (!uid) {
    return (
      <div className="screen center">
        <Spinner />
        <p>Connecting…</p>
      </div>
    );
  }
  if (engine) {
    return (
      <Game
        engine={engine}
        onClosed={() => {
          writeLocal(HOST_KEY, null);
          setEngine(null);
        }}
      />
    );
  }
  return (
    <Setup
      uid={uid}
      resumePin={resumePin}
      onDropResume={() => {
        setResumePin(null);
        writeLocal(HOST_KEY, null);
      }}
      onStarted={(e) => {
        writeLocal(HOST_KEY, {pin: e.view.pin});
        setEngine(e);
      }}
    />
  );
}

/* ------------------------------------------------------------------ setup */

function Setup({
  uid,
  resumePin,
  onDropResume,
  onStarted,
}: {
  uid: string;
  resumePin: string | null;
  onDropResume: () => void;
  onStarted: (e: HostEngine) => void;
}) {
  const [custom, setCustom] = useState<QuestionSet | null>(() => readLocal<QuestionSet>(CUSTOM_KEY));
  const [choice, setChoice] = useState<string>(() => (readLocal<QuestionSet>(CUSTOM_KEY) ? 'custom' : BUILT_IN_SETS[0].id));
  const [settings, setSettings] = useState<Settings>(() => ({...DEFAULT_SETTINGS, ...readLocal<Settings>(SETTINGS_KEY)}));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = choice === 'custom' ? custom : BUILT_IN_SETS.find((s) => s.id === choice)?.set;

  async function loadFile(f: File) {
    setError(null);
    try {
      const title = f.name.replace(/\.(json|xlsx)$/i, '').replace(/[_-]+/g, ' ');
      const loaded = /\.xlsx$/i.test(f.name)
        ? parseSetXlsx(new Uint8Array(await f.arrayBuffer()), title)
        : parseSetJson(await f.text(), title);
      setCustom(loaded);
      writeLocal(CUSTOM_KEY, loaded);
      setChoice('custom');
    } catch (e) {
      setError(`${f.name}: ${(e as Error).message}`);
    }
  }

  function download() {
    if (!set) return;
    const blob = new Blob([toFileJson(set)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${set.title.replace(/[^\w฀-๿-]+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function create() {
    if (!set) return;
    setBusy(true);
    setError(null);
    writeLocal(SETTINGS_KEY, settings);
    try {
      onStarted(await HostEngine.create(db, uid, set, settings));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function resume() {
    if (!resumePin) return;
    setBusy(true);
    const e = await HostEngine.resume(db, uid, resumePin).catch(() => null);
    setBusy(false);
    if (e) onStarted(e);
    else {
      setError(`Game ${resumePin} no longer exists.`);
      onDropResume();
    }
  }

  async function discard() {
    if (!resumePin) return;
    const e = await HostEngine.resume(db, uid, resumePin).catch(() => null);
    await e?.destroy().catch(() => {});
    onDropResume();
  }

  const num = (k: keyof Settings, min: number, max: number) => (
    <input
      type="number"
      min={min}
      max={max}
      value={settings[k] as number}
      onChange={(e) => setSettings({...settings, [k]: Math.max(min, Math.min(max, Number(e.target.value) || 0))})}
    />
  );

  return (
    <div className="screen setup">
      <header className="setup-head">
        <h1 className="brand">{APP_NAME}</h1>
        <span className="muted">Host screen</span>
      </header>

      {resumePin && (
        <div className="card resume">
          <div>
            <b>Game {resumePin} is still open.</b> Resume it on this screen, or delete it.
          </div>
          <div className="row">
            <button className="btn primary" onClick={resume} disabled={busy}>Resume game</button>
            <button className="btn ghost" onClick={discard} disabled={busy}>Delete it</button>
          </div>
        </div>
      )}

      <div className="setup-grid">
        <section className="card">
          <h2>1. Question set</h2>
          <div className="set-list">
            {BUILT_IN_SETS.map((s) => (
              <label key={s.id} className={`set-item ${choice === s.id ? 'on' : ''}`}>
                <input type="radio" name="set" checked={choice === s.id} onChange={() => setChoice(s.id)} />
                <span>
                  <b>{s.set.title}</b>
                  <small>{s.set.questions.length} questions · built in</small>
                </span>
              </label>
            ))}
            {custom && (
              <label className={`set-item ${choice === 'custom' ? 'on' : ''}`}>
                <input type="radio" name="set" checked={choice === 'custom'} onChange={() => setChoice('custom')} />
                <span>
                  <b>{custom.title}</b>
                  <small>{custom.questions.length} questions · loaded from a file (kept on this computer only)</small>
                </span>
                <button
                  className="link"
                  onClick={(e) => {
                    e.preventDefault();
                    setCustom(null);
                    writeLocal(CUSTOM_KEY, null);
                    setChoice(BUILT_IN_SETS[0].id);
                  }}
                >
                  remove
                </button>
              </label>
            )}
          </div>
          <div className="row">
            <button className="btn ghost" onClick={() => fileRef.current?.click()}>Load a file (.xlsx or .json)…</button>
            <button className="btn ghost" onClick={download} disabled={!set}>Save this set as .json</button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.xlsx,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadFile(f);
                e.target.value = '';
              }}
            />
          </div>
          <p className="muted small">
            .xlsx: the Kahoot-style template (header on row 8, questions from row 9: question, answers 1–4, time limit,
            correct answer number). A loaded file stays in this browser; only the question on screen is sent to phones,
            and the correct answer only after time is up.
          </p>
          {set && (
            <details className="preview">
              <summary>Preview the questions (and answers — careful if the projector is on)</summary>
              <ol>
                {set.questions.map((q, k) => (
                  <li key={k}>
                    <span>{q.q}</span>
                    <small>
                      {q.time}s · answer {q.correct.map((c) => c + 1).join(', ')}
                    </small>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>

        <section className="card">
          <h2>2. Settings</h2>
          <label className="field">
            <span>Reading time before answers open (seconds)</span>
            {num('previewSec', 0, 15)}
          </label>
          <label className="field">
            <span>Streak bonus per correct answer in a row</span>
            {num('streakStep', 0, 1000)}
          </label>
          <label className="field">
            <span>Maximum streak bonus per question</span>
            {num('streakCap', 0, 5000)}
          </label>
          <label className="field check">
            <input
              type="checkbox"
              checked={settings.lateJoin}
              onChange={(e) => setSettings({...settings, lateJoin: e.target.checked})}
            />
            <span>Students can join after the game has started</span>
          </label>
          <p className="muted small">
            Points: correct = 1000 × (1 − time taken ÷ time limit ÷ 2), so 500–1000; wrong or no answer = 0 and the streak
            resets. Streak bonus: +{settings.streakStep} for the 2nd correct answer in a row, +{settings.streakStep * 2} for
            the 3rd … up to +{settings.streakCap}.
          </p>
          {error && <div className="error">{error}</div>}
          <button className="btn primary block big" onClick={create} disabled={!set || busy}>
            {busy ? <Spinner /> : 'Create game'}
          </button>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ game */

function useHostView(engine: HostEngine): HostView {
  const [view, setView] = useState(engine.view);
  useEffect(() => engine.subscribe(setView), [engine]);
  return view;
}

function Game({engine, onClosed}: {engine: HostEngine; onClosed: () => void}) {
  const v = useHostView(engine);
  const [drawer, setDrawer] = useState(false);
  const s = v.state;
  const players = Object.keys(v.players).length;
  const online = Object.values(v.players).filter((p) => p.on).length;
  useTicker(s.phase === 'question', 100);

  // Browsers slow down timers in background tabs (down to once a minute); a worker's timer keeps the
  // question closing on time even if the projector tab is hidden behind slides.
  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 250);'], {type: 'text/javascript'}));
    const w = new Worker(url);
    w.onmessage = () => engine.tick();
    return () => {
      w.terminate();
      URL.revokeObjectURL(url);
    };
  }, [engine]);

  const endAndDelete = useCallback(async () => {
    await engine.destroy().catch(() => {});
    onClosed();
  }, [engine, onClosed]);

  const primary = useMemo((): {label: string; act: () => void; disabled?: boolean} | null => {
    switch (s.phase) {
      case 'lobby':
        return {label: 'Start', act: () => void engine.next(), disabled: players === 0};
      case 'question':
        return {label: 'Show answer now', act: () => void engine.close()};
      case 'reveal':
        return {label: s.i >= s.total - 1 ? 'Final results' : 'Leaderboard', act: () => void engine.next()};
      case 'board':
        return {label: s.i >= s.total - 1 ? 'Final results' : 'Next question', act: () => void engine.next()};
      default:
        return null;
    }
  }, [s.phase, s.i, s.total, players, engine]);

  // Space / Enter / → = the main button (works with a presentation clicker).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, button')) return;
      if ((e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'PageDown') && primary && !primary.disabled) {
        e.preventDefault();
        primary.act();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [primary]);

  let body: ReactNode;
  if (s.phase === 'lobby') body = <Lobby v={v} engine={engine} />;
  else if (s.phase === 'question' || s.phase === 'closing' || s.phase === 'reveal') body = <QuestionScreen v={v} engine={engine} />;
  else if (s.phase === 'board') body = <Board v={v} />;
  else body = <Podium v={v} />;

  return (
    <div className="screen host">
      <header className="h-bar">
        <span className="brand small">{APP_NAME}</span>
        {s.phase !== 'lobby' && (
          <span className="chip">
            Join: <b>{shortUrl()}</b> · PIN <b>{v.pin}</b>
          </span>
        )}
        <span className="spacer" />
        <button className="chip btnlike" onClick={() => setDrawer(true)} title="Show players (remove a player)">
          👥 {online}/{players}
        </button>
        <button
          className="chip btnlike"
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())}
          title="Full screen"
        >
          ⛶
        </button>
      </header>
      {!v.connected && <div className="offline">This screen is offline — reconnecting… (the game waits for it)</div>}
      {v.error && <div className="error wide">{v.error}</div>}
      <main className="h-body">{body}</main>
      <footer className="h-controls">
        {s.phase === 'lobby' && (
          <>
            <button className="btn ghost" onClick={() => void engine.setLocked(!v.pubSettings.locked)}>
              {v.pubSettings.locked ? '🔒 Locked — unlock' : 'Lock (no more players)'}
            </button>
            <button className="btn ghost" onClick={() => confirm('Cancel this game and delete it?') && void endAndDelete()}>
              Cancel game
            </button>
          </>
        )}
        {(s.phase === 'question' || s.phase === 'reveal' || s.phase === 'board') && (
          <>
            {s.phase === 'question' && (
              <button className="btn ghost" onClick={() => void engine.skip()} title="Next question, no points for this one">
                Skip question
              </button>
            )}
            <button className="btn ghost" onClick={() => confirm('End the game now and show the final results?') && void engine.finish()}>
              End game
            </button>
          </>
        )}
        {s.phase === 'podium' && (
          <button className="btn danger" onClick={() => void endAndDelete()}>
            Finish &amp; delete game data
          </button>
        )}
        <span className="spacer" />
        {s.phase === 'closing' && <Spinner />}
        {primary && (
          <button className="btn primary big" onClick={primary.act} disabled={primary.disabled}>
            {primary.label} →
          </button>
        )}
      </footer>
      {drawer && <PlayersDrawer v={v} engine={engine} onClose={() => setDrawer(false)} />}
    </div>
  );
}

function Lobby({v, engine}: {v: HostView; engine: HostEngine}) {
  const names = Object.entries(v.players).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
  return (
    <div className="lobby">
      <div className="lobby-join">
        <div className="join-steps">
          <div className="muted">Join at / เข้าที่</div>
          <div className="join-url">{shortUrl()}</div>
          <div className="muted">Game PIN / รหัสเกม</div>
          <div className="pin">{v.pin.slice(0, 3)} {v.pin.slice(3)}</div>
          <div className="muted small">Nickname only — no real names or student IDs · ใช้ชื่อเล่นเท่านั้น</div>
        </div>
        <Qr className="qr" text={joinUrl(v.pin)} />
      </div>
      <div className="lobby-title">
        <b>{v.set.title}</b> · {v.set.questions.length} questions
        <span className="count">{names.length} {names.length === 1 ? 'player' : 'players'}</span>
      </div>
      <div className="names">
        {names.length === 0 && <div className="muted">Waiting for players… / รอผู้เล่น…</div>}
        {names.map(([pid, p]) => (
          <button
            key={pid}
            className={`name ${p.on ? '' : 'away'}`}
            title="Click to remove this player"
            onClick={() => confirm(`Remove "${p.name}" from the game?`) && void engine.kick(pid)}
          >
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuestionScreen({v, engine}: {v: HostView; engine: HostEngine}) {
  const s = v.state;
  const q = v.set.questions[s.i];
  const now = engine.serverNow();
  const preview = s.phase === 'question' && now < s.startAt;
  const left = Math.max(0, s.startAt + s.limitMs - now);
  const reveal = s.phase === 'reveal' && v.reveal?.i === s.i ? v.reveal : undefined;
  const online = Object.values(v.players).filter((p) => p.on).length;
  const max = reveal ? Math.max(1, ...reveal.counts) : 1;
  return (
    <div className="qscreen">
      <div className="q-top">
        <span className="chip">
          {s.i + 1} / {s.total}
        </span>
      </div>
      <h1 className="q-text">{q.q}</h1>
      <div className="q-mid">
        {reveal ? (
          <div className="bars">
            {q.answers.map((a, k) =>
              a ? (
                <div key={k} className={`bar-col ${reveal.correct.includes(k) ? 'right' : 'wrong'}`}>
                  <div className="bar-n">{reveal.counts[k]}</div>
                  <div className={`bar t${k}`} style={{height: `${(reveal.counts[k] / max) * 100}%`}} />
                  <div className={`bar-foot t${k}`}>
                    <Shape k={k} size={26} />
                    {reveal.correct.includes(k) && <span className="tick">✔</span>}
                  </div>
                </div>
              ) : null,
            )}
          </div>
        ) : preview ? (
          <div className="ready">
            <div className="ready-n">{Math.ceil((s.startAt - now) / 1000)}</div>
            <div className="ready-bar">
              <div style={{animationDuration: `${v.settings.previewSec}s`}} />
            </div>
          </div>
        ) : (
          <div className="q-live">
            <div className="clock">{Math.ceil(left / 1000)}</div>
            <div className="answered">
              <b>{v.answered.length}</b>
              <span>
                of {online} answered
                <br />
                ตอบแล้ว
              </span>
            </div>
          </div>
        )}
      </div>
      {reveal && (
        <div className="reveal-note">
          {reveal.answered} of {Object.keys(v.players).length} answered ·{' '}
          {reveal.correct.reduce((n, k) => n + reveal.counts[k], 0)} correct
        </div>
      )}
      <div className={`h-tiles ${preview ? 'dim' : ''}`}>
        {q.answers.map((a, k) =>
          a ? (
            <div key={k} className={`tile t${k} ${reveal && !reveal.correct.includes(k) ? 'faded' : ''}`}>
              <Shape k={k} size={44} />
              <span>{a}</span>
              {reveal?.correct.includes(k) && <span className="tick">✔</span>}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}

function Board({v}: {v: HostView}) {
  const top = v.ranking.slice(0, 5);
  return (
    <div className="board">
      <h1>Leaderboard</h1>
      <ol>
        {top.map((r) => {
          const before = v.prevRanks[r.pid];
          const move = before ? before - r.rank : 0;
          return (
            <li key={r.pid}>
              <span className="b-rank">{r.rank}</span>
              <span className="b-name">
                {r.name}
                {r.streak > 1 && <small> 🔥{r.streak}</small>}
              </span>
              <span className={`b-move ${move > 0 ? 'up' : ''}`}>{move > 0 ? `▲${move}` : ''}</span>
              <span className="b-score">{r.score.toLocaleString()}</span>
            </li>
          );
        })}
        {top.length === 0 && <li className="muted">No players.</li>}
      </ol>
    </div>
  );
}

function Podium({v}: {v: HostView}) {
  const [first, second, third] = [1, 2, 3].map((place) => v.ranking.filter((r) => r.rank === place));
  const col = (rows: typeof first, place: number) => (
    <div className={`pod p${place}`}>
      <div className="pod-names">
        {rows.map((r) => (
          <div key={r.pid}>
            <b>{r.name}</b>
            <span>{r.score.toLocaleString()}</span>
          </div>
        ))}
      </div>
      <div className="pod-block">{ordinal(place)}</div>
    </div>
  );
  return (
    <div className="podium">
      <div className="pods">
        {col(second, 2)}
        {col(first, 1)}
        {col(third, 3)}
      </div>
      <div className="ranking">
        <h2>Full ranking</h2>
        <ol>
          {v.ranking.map((r) => (
            <li key={r.pid}>
              <span>{r.rank}.</span> <b>{r.name}</b> <span className="muted">{r.score.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function PlayersDrawer({v, engine, onClose}: {v: HostView; engine: HostEngine; onClose: () => void}) {
  const rows = Object.entries(v.players)
    .map(([pid, p]) => ({pid, p, score: v.scores[pid]?.score ?? 0}))
    .sort((a, b) => a.p.name.localeCompare(b.p.name));
  return (
    <div className="drawer-back" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <b>Players ({rows.length})</b>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </header>
        <p className="muted small">● connected · ○ phone asleep or offline. Removing a player deletes their answers and score.</p>
        <ul>
          {rows.map(({pid, p, score}) => (
            <li key={pid}>
              <span className={p.on ? 'dot on' : 'dot'}>{p.on ? '●' : '○'}</span>
              <span className="d-name">{p.name}</span>
              <span className="muted">{score.toLocaleString()}</span>
              <button className="btn ghost small" onClick={() => confirm(`Remove "${p.name}"?`) && void engine.kick(pid)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
