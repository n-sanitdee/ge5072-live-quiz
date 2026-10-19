// Question sets built into the app. This repo is public, so anyone can read these sets and their answers.
// One warm-up set per section (the title starts with the section code), so a class recording doesn't give
// later sections the answers. The host screen lists them in this order.
import {parseSetJson} from '../game/sets.ts';
import type {QuestionSet} from '../game/types.ts';
import warmupCa48Ec30 from './warmup-1-2026.json';
import warmupBs11 from './warmup-bs11.json';
import warmupTs66 from './warmup-ts66.json';
import warmupCa50 from './warmup-ca50.json';
import warmupAc21 from './warmup-ac21.json';

export const BUILT_IN_SETS: {id: string; set: QuestionSet}[] = [
  {id: 'warmup-bs11', set: parseSetJson(JSON.stringify(warmupBs11))},
  {id: 'warmup-ts66', set: parseSetJson(JSON.stringify(warmupTs66))},
  {id: 'warmup-ca50', set: parseSetJson(JSON.stringify(warmupCa50))},
  {id: 'warmup-ac21', set: parseSetJson(JSON.stringify(warmupAc21))},
  {id: 'warmup-1-2026', set: parseSetJson(JSON.stringify(warmupCa48Ec30))},
];
