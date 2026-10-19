// Question-set formats: the JSON files in src/sets/ and the Kahoot-style spreadsheet.
import type {Question, QuestionSet} from './types.ts';
import {readXlsx} from './xlsx.ts';

export const MAX_QUESTION = 120;
export const MAX_ANSWER = 75;
export const MAX_TIME = 240;

/**
 * JSON on disk uses answer NUMBERS (1 = first answer), like the spreadsheet:
 * {"title": "...", "questions": [{"q": "...", "answers": ["a","b","c","d"], "correct": [2], "time": 20}]}
 */
type FileQuestion = {q?: unknown; question?: unknown; answers?: unknown; correct?: unknown; time?: unknown};

function clean(s: unknown): string {
  return typeof s === 'string' || typeof s === 'number' ? String(s).replace(/\s+/g, ' ').trim() : '';
}

function parseCorrect(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,;\s]+/);
  return [...new Set(list.map((x) => Number(String(x).trim())).filter((n) => Number.isInteger(n)))];
}

/** Check one question and convert answer numbers (1–4) to slots (0–3). Throws a readable message. */
function toQuestion(raw: FileQuestion, n: number): Question {
  const where = `Question ${n}`;
  const q = clean(raw.q ?? raw.question);
  if (!q) throw new Error(`${where}: the question text is empty.`);
  if (q.length > MAX_QUESTION) throw new Error(`${where}: the question is longer than ${MAX_QUESTION} characters.`);
  const given = Array.isArray(raw.answers) ? raw.answers.map(clean) : [];
  if (given.length > 4) throw new Error(`${where}: at most 4 answers.`);
  const answers = [0, 1, 2, 3].map((k) => given[k] ?? '');
  if (answers.filter(Boolean).length < 2) throw new Error(`${where}: needs at least 2 answers.`);
  const long = answers.findIndex((a) => a.length > MAX_ANSWER);
  if (long >= 0) throw new Error(`${where}: answer ${long + 1} is longer than ${MAX_ANSWER} characters.`);
  const nums = parseCorrect(raw.correct);
  if (!nums.length) throw new Error(`${where}: no correct answer number (1–4).`);
  for (const k of nums) {
    if (k < 1 || k > 4 || !answers[k - 1]) throw new Error(`${where}: correct answer ${k} is not one of its answers.`);
  }
  const time = Number(raw.time ?? 20);
  if (!Number.isFinite(time) || time < 5 || time > MAX_TIME) throw new Error(`${where}: time limit must be 5–${MAX_TIME} seconds.`);
  return {q, answers, correct: nums.map((k) => k - 1).sort(), time: Math.round(time)};
}

export function parseSetJson(text: string, fallbackTitle = 'Question set'): QuestionSet {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const obj = (Array.isArray(data) ? {questions: data} : data) as {title?: unknown; questions?: unknown};
  if (!obj || !Array.isArray(obj.questions) || !obj.questions.length) throw new Error('No questions found ("questions": [...]).');
  return {
    title: clean(obj.title) || fallbackTitle,
    questions: obj.questions.map((q, k) => toQuestion(q as FileQuestion, k + 1)),
  };
}

/**
 * Kahoot-style template: a header row whose column B starts with "Question",
 * then one question per row — B question, C–F answers 1–4, G time limit, H correct answer number(s).
 */
export function parseSetXlsx(data: Uint8Array, fallbackTitle = 'Question set'): QuestionSet {
  const rows = readXlsx(data);
  const nums = [...rows.keys()].sort((a, b) => a - b);
  const header = nums.find((r) => /^question/i.test(rows.get(r)?.get('B') ?? ''));
  const start = header !== undefined ? header + 1 : 9;
  const questions: Question[] = [];
  for (const r of nums) {
    if (r < start) continue;
    const row = rows.get(r)!;
    const q = row.get('B');
    if (!q) continue;
    questions.push(
      toQuestion(
        {q, answers: ['C', 'D', 'E', 'F'].map((c) => row.get(c) ?? ''), time: row.get('G') ?? 20, correct: row.get('H')},
        questions.length + 1,
      ),
    );
  }
  if (!questions.length) throw new Error('No questions found. Use the Kahoot-style template: header on row 8, questions from row 9.');
  return {title: fallbackTitle, questions};
}

/** For saving a set back to disk (answer numbers 1–4). */
export function toFileJson(set: QuestionSet): string {
  return JSON.stringify(
    {
      title: set.title,
      questions: set.questions.map((q) => ({
        q: q.q,
        answers: q.answers.filter((_, k) => k < 2 || q.answers.slice(k).some(Boolean)),
        correct: q.correct.map((k) => k + 1),
        time: q.time,
      })),
    },
    null,
    2,
  );
}
