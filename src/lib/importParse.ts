// Reads a spreadsheet (.csv or .xlsx) into plain rows, and guesses which column is which.
import type { ImportRowIn } from './types';

export type Grid = string[][];
export const FIELDS = [
  { key: 'name', label: 'Name', need: true, match: /^(full\s*)?name|^names?$|member/i },
  { key: 'phone', label: 'Phone', match: /phone|contact|mobile|cell|number|whats/i },
  { key: 'voice', label: 'Voice part', match: /voice|part|section/i },
  { key: 'area', label: 'Area', match: /^area|region|zone/i },
  { key: 'district', label: 'District', match: /district/i },
  { key: 'congregation', label: 'Congregation', match: /congregation|church|assembly|local/i },
  { key: 'title', label: 'Title', match: /^title|salutation|brother|sister/i },
  { key: 'at', label: 'Registered at (date and time)', match: /time\s*stamp|timestamp|submitted|registered|date/i },
] as const;
export type FieldKey = (typeof FIELDS)[number]['key'];
export type Mapping = Partial<Record<FieldKey, number>>;

/** Small CSV reader: quotes, commas inside quotes, and either line ending. Semicolons are used when there are no commas. */
export function parseCsv(text: string): Grid {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = first.split(';').length > first.split(',').length ? ';' : first.includes('\t') && !first.includes(',') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
};

export async function readFile(file: File): Promise<Grid> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    const data = await readSheet(file);
    return (data as unknown[][]).map((r) => r.map(cellText)).filter((r) => r.some((c) => c !== ''));
  }
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type.startsWith('text/')) return parseCsv(await file.text()).map((r) => r.map((c) => c.trim()));
  throw new Error('Please choose a .csv or .xlsx file. (Older .xls files: open them in Excel and save as .xlsx first.)');
}

export function guessMapping(header: string[]): Mapping {
  const m: Mapping = {};
  const used = new Set<number>();
  for (const f of FIELDS) {
    const i = header.findIndex((h, idx) => !used.has(idx) && f.match.test(h.trim()));
    if (i >= 0) { m[f.key] = i; used.add(i); }
  }
  return m;
}

/** Excel dates arrive as ISO text, CSV dates as typed text; keep only what the database can read. */
function toTimestamp(s: string): string | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()) && /\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(s)) return d.toISOString();
  return undefined;
}

export function toRows(grid: Grid, header: boolean, map: Mapping): ImportRowIn[] {
  const out: ImportRowIn[] = [];
  for (const r of header ? grid.slice(1) : grid) {
    const get = (k: FieldKey) => (map[k] === undefined ? '' : (r[map[k]!] ?? '').trim());
    const name = get('name');
    if (!name && !r.some((c) => c.trim())) continue;
    const at = toTimestamp(get('at'));
    out.push({ name, phone: get('phone'), voice: get('voice'), area: get('area'), district: get('district'), congregation: get('congregation'), title: get('title'), ...(at ? { at } : {}) });
  }
  return out;
}
