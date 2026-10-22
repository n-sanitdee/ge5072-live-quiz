// Question sets built into the app. This repo is public, so anyone can read these sets and their answers.
// One warm-up set per section (the title starts with the section code), so a class recording doesn't give
// later sections the answers. The lesson sets come after the warm-ups, so the default (the first set, BS11)
// stays the same. The host screen lists them in this order, with a heading wherever `group` changes.
import {parseSetJson} from '../game/sets.ts';
import type {QuestionSet} from '../game/types.ts';
import warmupCa48Ec30 from './warmup-1-2026.json';
import warmupBs11 from './warmup-bs11.json';
import warmupTs66 from './warmup-ts66.json';
import warmupCa50 from './warmup-ca50.json';
import warmupAc21 from './warmup-ac21.json';
import wk13SentenceCheck from './lesson-wk13-sentence-check.json';
import wk14VerbOrNoun from './lesson-wk14-verb-or-noun.json';

const WARMUPS = 'Week 12 · Pop Quiz warm-ups (pick your section)';
const LESSONS = 'Weeks 13–14 · Final Project lessons';

export const BUILT_IN_SETS: {id: string; group: string; set: QuestionSet}[] = [
  {id: 'warmup-bs11', group: WARMUPS, set: parseSetJson(JSON.stringify(warmupBs11))},
  {id: 'warmup-ts66', group: WARMUPS, set: parseSetJson(JSON.stringify(warmupTs66))},
  {id: 'warmup-ca50', group: WARMUPS, set: parseSetJson(JSON.stringify(warmupCa50))},
  {id: 'warmup-ac21', group: WARMUPS, set: parseSetJson(JSON.stringify(warmupAc21))},
  {id: 'warmup-1-2026', group: WARMUPS, set: parseSetJson(JSON.stringify(warmupCa48Ec30))},
  {id: 'wk13-sentence-check', group: LESSONS, set: parseSetJson(JSON.stringify(wk13SentenceCheck))},
  {id: 'wk14-verb-or-noun', group: LESSONS, set: parseSetJson(JSON.stringify(wk14VerbOrNoun))},
];
