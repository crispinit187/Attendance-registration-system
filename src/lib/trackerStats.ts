import type { TrackerAnalytics } from './types';

export const DEFAULT_EXPECTED = 200;
export const COLORS = ['c1', 'c2', 'c3', 'c4'];
export const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export const fmtD = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtShort = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;

export function totals(a: TrackerAnalytics) {
  const present = a.lists.reduce((s, l) => s + l.present, 0);
  const people = a.lists.reduce((s, l) => s + l.people, 0);
  const expected = a.lists.reduce((s, l) => s + (l.expected ?? DEFAULT_EXPECTED), 0);
  return { present, people, expected };
}

/** Sum rows by name across lists. */
export function sumBy(rows: { name: string; n: number }[]): { name: string; n: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.name, (m.get(r.name) ?? 0) + r.n);
  return [...m.entries()].map(([name, n]) => ({ name, n })).sort((x, y) => y.n - x.n || x.name.localeCompare(y.name));
}

export function headline(a: TrackerAnalytics): string {
  const t = totals(a);
  const when = a.date ? `on ${fmtD(a.date)}` : 'across all dates';
  const listWord = a.lists.length === 1 ? a.lists[0]!.title : `${a.lists.length} lists`;
  if (!t.people) return `No one is registered on ${listWord} yet.`;
  return `${t.present} ${t.present === 1 ? 'person' : 'people'} attended ${when} (${listWord}), ${pct(t.present, t.expected)}% of the ${t.expected} expected and ${pct(t.present, t.people)}% of the ${t.people} registered.`;
}
