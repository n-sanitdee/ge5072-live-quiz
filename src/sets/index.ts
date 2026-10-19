// Question sets built into the app. Only add sets that are safe to make PUBLIC (this repo is public).
import {parseSetJson} from '../game/sets.ts';
import type {QuestionSet} from '../game/types.ts';
import warmup from './warmup-1-2026.json';

export const BUILT_IN_SETS: {id: string; set: QuestionSet}[] = [
  {id: 'warmup-1-2026', set: parseSetJson(JSON.stringify(warmup))},
];
