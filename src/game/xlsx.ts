// Minimal .xlsx reader: enough for the Kahoot-style question spreadsheet (first sheet, text and numbers).
import {strFromU8, unzipSync} from 'fflate';

export type Rows = Map<number, Map<string, string>>;

const ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};

function decode(s: string): string {
  return s
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&(#x[0-9A-Fa-f]+|#\d+|\w+);/g, (m, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e] ?? m;
    });
}

/** Text of every <t> element inside a fragment (rich-text runs are concatenated). */
function texts(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += m[1] ?? '';
  return decode(out);
}

function firstSheetPath(files: Record<string, Uint8Array>): string {
  const wb = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : '';
  const rels = files['xl/_rels/workbook.xml.rels'] ? strFromU8(files['xl/_rels/workbook.xml.rels']) : '';
  const sheet = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/) ?? wb.match(/<sheet\b[^>]*\bid="([^"]+)"/);
  if (sheet && rels) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = m[0].match(/\bId="([^"]+)"/)?.[1];
      const target = m[0].match(/\bTarget="([^"]+)"/)?.[1];
      if (id === sheet[1] && target) return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    }
  }
  const any = Object.keys(files).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();
  if (!any.length) throw new Error('No worksheet found in this file.');
  return any[0];
}

/** Read the first worksheet into row number → column letter → cell text. */
export function readXlsx(data: Uint8Array): Rows {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new Error('This is not an .xlsx file (Excel 2007 or later).');
  }
  const shared: string[] = [];
  if (files['xl/sharedStrings.xml']) {
    for (const m of strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]));
  }
  const path = firstSheetPath(files);
  if (!files[path]) throw new Error('No worksheet found in this file.');
  const sheet = strFromU8(files[path]);
  const rows: Rows = new Map();
  for (const m of sheet.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1];
    const inner = m[2] ?? '';
    const ref = attrs.match(/\br="([A-Z]+)(\d+)"/);
    if (!ref) continue;
    const type = attrs.match(/\bt="([^"]+)"/)?.[1];
    const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    let value = '';
    if (type === 's') value = v !== undefined ? (shared[Number(v)] ?? '') : '';
    else if (type === 'inlineStr') value = texts(inner);
    else if (v !== undefined) value = decode(v);
    if (value === '') continue;
    const row = Number(ref[2]);
    if (!rows.has(row)) rows.set(row, new Map());
    rows.get(row)!.set(ref[1], value);
  }
  return rows;
}
