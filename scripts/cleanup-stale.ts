// Delete games older than 3 hours (run hourly by .github/workflows/cleanup.yml).
// Signs in as a throw-away anonymous user, deletes stale games, then deletes that user. No secrets needed.
// CLEANUP_EMULATOR=1 runs it against the local emulators (for testing).
import {deleteApp} from 'firebase/app';
import {getAuth} from 'firebase/auth';
import {onValue, ref} from 'firebase/database';
import {firebaseConfig} from '../src/firebase-config.ts';
import {EMULATOR_CONFIG, openDatabase, signInHost} from '../src/game/fb.ts';
import {HostEngine} from '../src/game/host.ts';

const emu = process.env.CLEANUP_EMULATOR === '1';
const backend = emu ? {config: EMULATOR_CONFIG, emulatorHost: '127.0.0.1'} : {config: firebaseConfig};
if (!backend.config.databaseURL) {
  console.log('Firebase is not configured yet — nothing to do.');
  process.exit(0);
}

const {app, db} = openDatabase(backend);
await signInHost(app, backend);
try {
  const offset = await new Promise<number>((resolve) => {
    const off = onValue(ref(db, '.info/serverTimeOffset'), (s) => {
      off();
      resolve(s.val() ?? 0);
    });
  });
  const n = await HostEngine.cleanupStale(db, Date.now() + offset - 4 * 60 * 1000);
  console.log(`Deleted ${n} stale game(s).`);
} finally {
  await getAuth(app).currentUser?.delete().catch((e) => console.warn('Could not delete the temporary user:', e.message));
  await deleteApp(app);
}
process.exit(0);
