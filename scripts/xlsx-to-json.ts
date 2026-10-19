// Convert a Kahoot-style question spreadsheet into a JSON set for src/sets/.
// Usage: node scripts/xlsx-to-json.ts <input.xlsx> <output.json> "<Set title>"
import {readFileSync, writeFileSync} from 'node:fs';
import {parseSetXlsx, toFileJson} from '../src/game/sets.ts';

const [input, output, title] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/xlsx-to-json.ts <input.xlsx> <output.json> "<Set title>"');
  process.exit(1);
}
const set = parseSetXlsx(new Uint8Array(readFileSync(input)), title || 'Question set');
writeFileSync(output, toFileJson(set) + '\n');
console.log(`${set.questions.length} questions → ${output}`);
