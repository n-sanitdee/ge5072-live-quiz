import type {Backend} from './game/fb.ts';
import {EMULATOR_CONFIG} from './game/fb.ts';
import {firebaseConfig} from './firebase-config.ts';

// `npm run dev:emu` (or ?emu in the URL during local development) talks to the local emulators.
const useEmulator =
  import.meta.env.VITE_USE_EMULATOR === '1' || (import.meta.env.DEV && new URLSearchParams(location.search).has('emu'));

export const backend: Backend = useEmulator
  ? {config: EMULATOR_CONFIG, emulatorHost: location.hostname === 'localhost' ? '127.0.0.1' : location.hostname}
  : {config: firebaseConfig};

export const configured = useEmulator || !!firebaseConfig.databaseURL;
