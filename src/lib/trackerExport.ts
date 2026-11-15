// Exports for trackers (Excel grid, PDF grid) and the PDF analytics report (used by trackers and attendance events).
import type { Breakdown, TrackerAnalytics, TrackerGrid } from './types';
import { download, fmtDateTime, safeName } from './format';
import { DEFAULT_EXPECTED, fmtD, fmtShort, headline, hourLabel, pct, sumBy, totals } from './trackerStats';

type Cell = string | number | null;

// The look of every PDF: dark slate text, one blue accent, light grey rows. Readable printed in black and white.
type RGB = [number, number, number];
const INK: RGB = [22, 32, 43], MUTED: RGB = [107, 118, 132], ACCENT: RGB = [31, 107, 255], LINE: RGB = [221, 226, 232];
const ZEBRA: RGB = [245, 247, 249], HEAD: RGB = [30, 42, 56], OK: RGB = [30, 142, 90], TRACK: RGB = [230, 234, 239];
interface Pdf { setTextColor: (r: number, g: number, b: number) => unknown; setDrawColor: (r: number, g: number, b: number) => unknown; setFillColor: (r: number, g: number, b: number) => unknown }
const setC = (doc: Pdf, c: RGB, kind: 'text' | 'draw' | 'fill') => { if (kind === 'text') doc.setTextColor(...c); else if (kind === 'draw') doc.setDrawColor(...c); else doc.setFillColor(...c); };
function pageFooter(doc: import('jspdf').jsPDF, W: number, H: number, M: number, left: string, page: number, pages: number) {
  setC(doc, LINE, 'draw'); doc.setLineWidth(0.6); doc.line(M, H - 34, W - M, H - 34);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setC(doc, MUTED, 'text');
  doc.text(left, M, H - 20, { maxWidth: W - 2 * M - 220 });
  doc.text('Built by CrispinIT Labs', W - M - 80, H - 20, { align: 'right' });
  doc.text(`Page ${page} of ${pages}`, W - M, H - 20, { align: 'right' });
}

export interface GridExportOpts {
  /** One date (YYYY-MM-DD) or null for all dates. */
  date?: string | null;
  /** With one date chosen: also list the people who were not there. */
  includeAbsent?: boolean;
}

function gridTable(grids: TrackerGrid[], contact: boolean, marks: string, opts: GridExportOpts = {}) {
  const multi = grids.length > 1;
  const only = opts.date ?? null;
  const dateKeys = only ? [only] : [...new Set(grids.flatMap((g) => g.dates.filter((d) => !d.removed && d.started !== false).map((d) => d.on_date)))].sort();
  const head = ['#', 'Name', ...(multi ? ['List'] : []), 'Voice', 'Area', 'District', 'Congregation', ...(contact ? ['Phone'] : []), ...dateKeys.map(fmtShort), 'Total'];
  const body: Cell[][] = [];
  let everyone = 0;
  for (const g of grids) {
    const idOf = new Map(g.dates.filter((d) => !d.removed).map((d) => [d.on_date, d.id]));
    for (const r of g.rows.filter((x) => !x.removed)) {
      everyone++;
      const m = new Set(r.marks);
      const flags = dateKeys.map((k) => { const id = idOf.get(k); return id && m.has(id) ? marks : ''; });
      const total = dateKeys.filter((k) => { const id = idOf.get(k); return id && m.has(id); }).length;
      if (only && !opts.includeAbsent && total === 0) continue;
      body.push([body.length + 1, [r.title, r.title_specify ? `(${r.title_specify})` : '', r.name].filter(Boolean).join(' '),
        ...(multi ? [g.list.title] : []), r.voice ?? '', r.area ?? '', r.district ?? '', r.congregation ?? '',
        ...(contact ? [r.contact ?? ''] : []), ...flags, total]);
    }
  }
  const firstDate = head.length - 1 - dateKeys.length;   // index of the first date column
  const present = dateKeys.map((_, i) => body.filter((row) => row[firstDate + i] === marks).length);
  return { head, body, dateKeys, present, everyone, firstDate };
}

export async function exportTrackerGrid(eventName: string, grids: TrackerGrid[], contact: boolean, format: 'xlsx' | 'pdf', opts: GridExportOpts = {}) {
  const listTitle = grids.length === 1 ? grids[0]!.list.title : 'All lists';
  const dayLabel = opts.date ? fmtD(opts.date) : 'All dates';
  const name = safeName(`${eventName} - ${listTitle}${opts.date ? ` - ${opts.date}` : ''}`);
  const { head, body, present, everyone, firstDate, dateKeys } = gridTable(grids, contact, format === 'xlsx' ? '✓' : 'Yes', opts);
  if (format === 'xlsx') {
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const data = [head.map((h) => ({ value: h, fontWeight: 'bold' as const })), ...body.map((r) => r.map((c) => (c === '' || c === null ? null : { value: c })))];
    const blob = await writeXlsxFile(data as never, {
      sheet: listTitle.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1',
      columns: head.map((h) => ({ width: h === 'Name' ? 28 : h === '#' ? 5 : 14 })), stickyRowsCount: 1,
    }).toBlob();
    download(blob, `${name}.xlsx`);
    return;
  }
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 42;
  // header block
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setC(doc, ACCENT, 'text'); doc.text(eventName.toUpperCase(), M, 46);
  doc.setFontSize(24); setC(doc, INK, 'text'); doc.text(listTitle, M, 74);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setC(doc, MUTED, 'text');
  doc.text(opts.date ? `Attendance for ${dayLabel}${opts.includeAbsent ? ' · present and absent' : ' · people present'}` : 'Attendance: names and ticks · all dates', M, 92);
  // summary cards
  const people = everyone;
  const cards: [string, string][] = opts.date
    ? [['PEOPLE ON LIST', String(people)], ['PRESENT', String(present[0] ?? 0)], ['ABSENT', String(Math.max(0, people - (present[0] ?? 0)))], ['ATTENDANCE', `${pct(present[0] ?? 0, people)}%`]]
    : [['PEOPLE ON LIST', String(people)], ['DATES', String(dateKeys.length)],
       ['AVERAGE PRESENT', dateKeys.length ? String(Math.round(present.reduce((x, y) => x + y, 0) / dateKeys.length)) : '0'],
       ['AVERAGE ATTENDANCE', `${pct(dateKeys.length ? present.reduce((x, y) => x + y, 0) / dateKeys.length : 0, people)}%`]];
  const cw = (W - 2 * M) / cards.length;
  cards.forEach(([label, value], i) => {
    const x = M + i * cw;
    setC(doc, LINE, 'draw'); doc.setLineWidth(0.6); doc.rect(x, 108, cw, 46);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); setC(doc, MUTED, 'text'); doc.text(label, x + 10, 123);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(17); setC(doc, INK, 'text'); doc.text(value, x + 10, 145);
  });
  const isTick = (i: number) => i >= firstDate && i < firstDate + dateKeys.length;
  autoTable(doc, {
    startY: 168, margin: { left: M, right: M, bottom: 44, top: 40 },
    head: [head], body: body.map((r) => r.map((c, i) => (isTick(i) && c === 'Yes' ? '' : String(c ?? '')))),
    foot: [head.map((_, i) => (i === 1 ? 'Present' : isTick(i) ? String(present[i - firstDate] ?? 0) : ''))],
    showFoot: 'lastPage',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 5, bottom: 5, left: 6, right: 6 }, textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.4 } },
    headStyles: { fillColor: HEAD, textColor: 255, fontStyle: 'bold', fontSize: 8, lineWidth: 0 },
    footStyles: { fillColor: [255, 255, 255], textColor: INK, fontStyle: 'bold', lineWidth: { top: 1.2 }, lineColor: INK },
    alternateRowStyles: { fillColor: ZEBRA },
    columnStyles: Object.fromEntries(head.map((h, i) => [i, h === '#' ? { cellWidth: 26, textColor: MUTED } : h === 'Name' ? { fontStyle: 'bold' } : isTick(i) || h === 'Total' ? { halign: 'center' } : {}])) as never,
    didParseCell: (d) => { if (d.section === 'head' && (isTick(d.column.index) || d.column.index === head.length - 1)) d.cell.styles.halign = 'center'; if (d.section === 'foot' && isTick(d.column.index)) d.cell.styles.halign = 'center'; },
    didDrawCell: (d) => {
      if (d.section !== 'body' || !isTick(d.column.index)) return;
      const raw = body[d.row.index]?.[d.column.index];
      if (raw !== 'Yes') return;
      const cx = d.cell.x + d.cell.width / 2, cy = d.cell.y + d.cell.height / 2;
      setC(doc, OK, 'draw'); doc.setLineWidth(1.6); doc.setLineCap('round'); doc.setLineJoin('round');
      doc.lines([[3, 3.2], [6.5, -7]], cx - 5, cy + 0.5, [1, 1], 'S', false);
    },
  });
  const stamp = fmtDateTime(new Date().toISOString());
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    setC(doc, ACCENT, 'fill'); doc.rect(0, 0, W, 11, 'F');
    pageFooter(doc, W, H, M, `${eventName} · ${listTitle}  ·  exported ${stamp}`, i, n);
  }
  doc.save(`${name}.pdf`);
}

// ---------------------------------------------------------------------------------------------
// PDF analytics report
interface Section { title: string; head: string[]; body: Cell[][]; note?: string }
interface Report {
  title: string; subtitle: string; headline: string;
  stats: [string, string][];
  bars?: { title: string; rows: { label: string; value: number; of: number; text: string }[] };
  sections: Section[]; file: string;
}

async function renderReport(r: Report) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 46;
  const need = (y: number, h: number) => { if (y + h > H - 60) { doc.addPage(); return 56; } return y; };
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setC(doc, ACCENT, 'text'); doc.text('ATTENDANCE REPORT', M, 50);
  doc.setFontSize(22); setC(doc, INK, 'text');
  const titleLines = doc.splitTextToSize(r.title.replace(/ · attendance report$/i, ''), W - 2 * M) as string[];
  doc.text(titleLines, M, 76);
  let y = 76 + (titleLines.length - 1) * 26;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setC(doc, MUTED, 'text'); doc.text(r.subtitle, M, y + 18, { maxWidth: W - 2 * M });
  y += 40;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); setC(doc, INK, 'text');
  const hl = doc.splitTextToSize(r.headline, W - 2 * M) as string[];
  doc.text(hl, M, y + 8);
  y += hl.length * 17 + 14;
  const gap = 8, bw = (W - 2 * M - gap * (r.stats.length - 1)) / Math.max(1, r.stats.length);
  r.stats.forEach(([label, value], i) => {
    const x = M + i * (bw + gap);
    setC(doc, LINE, 'draw'); doc.setLineWidth(0.6); doc.rect(x, y, bw, 50);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); setC(doc, MUTED, 'text'); doc.text(doc.splitTextToSize(label.toUpperCase(), bw - 16) as string[], x + 9, y + 15);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); setC(doc, INK, 'text'); doc.text(value, x + 9, y + 41);
  });
  y += 72;
  if (r.bars?.rows.length) {
    y = need(y, 40);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); setC(doc, INK, 'text'); doc.text(r.bars.title, M, y); y += 12;
    const lw = 130, rw = 150, tw = W - 2 * M - lw - rw;
    for (const b of r.bars.rows) {
      y = need(y, 22);
      setC(doc, LINE, 'draw'); doc.setLineWidth(0.4); doc.line(M, y + 15, W - M, y + 15);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setC(doc, INK, 'text'); doc.text(doc.splitTextToSize(b.label, lw - 8)[0] as string, M, y + 9);
      setC(doc, TRACK, 'fill'); doc.rect(M + lw, y + 3, tw, 7, 'F');
      setC(doc, ACCENT, 'fill'); doc.rect(M + lw, y + 3, Math.max(1, tw * Math.min(1, b.value / Math.max(1, b.of))), 7, 'F');
      setC(doc, MUTED, 'text'); doc.text(b.text, W - M, y + 9, { align: 'right' });
      y += 22;
    }
    y += 12;
  }
  for (const s of r.sections) {
    if (!s.body.length) continue;
    y = need(y, 70);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); setC(doc, INK, 'text'); doc.text(s.title, M, y);
    autoTable(doc, {
      startY: y + 7, margin: { left: M, right: M, bottom: 50, top: 50 }, head: [s.head], body: s.body.map((row) => row.map((c) => String(c ?? ''))),
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 5, bottom: 5, left: 7, right: 7 }, textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.4 } },
      headStyles: { fillColor: HEAD, textColor: 255, fontStyle: 'bold', fontSize: 8, lineWidth: 0 },
      alternateRowStyles: { fillColor: ZEBRA },
      columnStyles: Object.fromEntries(s.head.map((_, i) => [i, i === 0 ? {} : { halign: 'right' }])) as never,
      didParseCell: (d) => { if (d.section === 'head' && d.column.index > 0) d.cell.styles.halign = 'right'; },
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 40) + 22;
    if (s.note) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setC(doc, MUTED, 'text'); doc.text(s.note, M, y - 10); }
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    setC(doc, ACCENT, 'fill'); doc.rect(0, 0, W, 11, 'F');
    pageFooter(doc, W, H, M, `Attendance report  ·  created ${fmtDateTime(new Date().toISOString())}`, i, n);
  }
  doc.save(r.file);
}

export async function trackerReportPdf(a: TrackerAnalytics) {
  const t = totals(a);
  const voices = sumBy(a.voices), titles = sumBy(a.titles);
  const nameOf = new Map(a.lists.map((l) => [l.id, l.title]));
  await renderReport({
    title: `${a.event.name} · attendance report`,
    subtitle: `${a.date ? fmtD(a.date) : 'All dates'} · ${a.lists.length} list(s) · created ${fmtDateTime(new Date().toISOString())}`,
    headline: headline(a),
    stats: [['Attended', String(t.present)], ['Registered', String(t.people)], ['Of expected', `${pct(t.present, t.expected)}%`],
      ['Came every date', String(a.lists.reduce((s, l) => s + l.every_date, 0))], ['Never ticked', String(a.lists.reduce((s, l) => s + l.never, 0))]],
    bars: { title: 'Attendance against what was expected', rows: a.lists.map((l) => ({ label: l.title, value: l.present, of: l.expected ?? DEFAULT_EXPECTED, text: `${l.present} of ${l.expected ?? DEFAULT_EXPECTED} (${pct(l.present, l.expected ?? DEFAULT_EXPECTED)}%)` })) },
    sections: [
      { title: 'Lists', head: ['List', 'Registered', 'Attended', 'Expected', 'Every date', 'Never'], body: a.lists.map((l) => [l.title, l.people, l.present, l.expected ?? DEFAULT_EXPECTED, l.every_date, l.never]) },
      { title: 'Attendance by date', head: ['List', 'Date', 'Present'], body: a.trend.map((x) => [nameOf.get(x.list_id) ?? '', fmtD(x.on_date), x.present]) },
      { title: 'By voice part', head: ['Voice part', 'People'], body: voices.map((v) => [v.name, v.n]) },
      { title: 'By title', head: ['Title', 'People'], body: titles.map((v) => [v.name, v.n]) },
      { title: 'By district', head: ['List', 'District', 'People'], body: a.districts.sort((x, y) => (nameOf.get(x.list_id) ?? '').localeCompare(nameOf.get(y.list_id) ?? '') || y.n - x.n).map((d) => [nameOf.get(d.list_id) ?? '', d.name, d.n]) },
      { title: 'By congregation', head: ['Congregation', 'People'], body: a.congregations.map((c) => [c.name, c.n]) },
      { title: 'When people were registered', head: ['Hour (Lusaka time)', 'Ticks'], body: a.timeline.map((h) => [hourLabel(h.hour), h.n]) },
    ],
    file: `${safeName(a.event.name + ' report')}.pdf`,
  });
}

/** The same style of report for an attendance event, built from its per-list breakdown. */
export async function attendanceReportPdf(eventName: string, rows: Breakdown[], registered?: number) {
  const total = rows.reduce((s, r) => s + r.total, 0);
  const merge = (pick: (b: Breakdown) => Record<string, number>) => {
    const m = new Map<string, number>();
    for (const b of rows) for (const [k, v] of Object.entries(pick(b))) m.set(k, (m.get(k) ?? 0) + v);
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  };
  const max = Math.max(1, ...rows.map((r) => r.total));
  await renderReport({
    title: `${eventName} · attendance report`,
    subtitle: `${rows.length} list(s) · created ${fmtDateTime(new Date().toISOString())}`,
    headline: `${total} attendance record(s) across ${rows.length} list(s)${registered ? `, ${registered} different people` : ''}.`,
    stats: [['Records', String(total)], ['Lists', String(rows.length)], ['Busiest list', rows.length ? [...rows].sort((a, b) => b.total - a.total)[0]!.title : '-']],
    bars: { title: 'Attendance by list', rows: rows.map((r) => ({ label: r.title, value: r.total, of: max, text: `${r.total}` })) },
    sections: [
      { title: 'Lists', head: ['List', 'Status', 'Present'], body: rows.map((r) => [r.title, r.status, r.total]) },
      { title: 'By area', head: ['Area', 'People'], body: merge((b) => b.areas) },
      { title: 'By voice part', head: ['Voice part', 'People'], body: merge((b) => b.voices) },
      { title: 'By district', head: ['District', 'People'], body: merge((b) => b.districts) },
    ],
    file: `${safeName(eventName + ' report')}.pdf`,
  });
}
