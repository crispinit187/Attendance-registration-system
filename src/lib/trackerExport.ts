// Exports for trackers (Excel grid, PDF grid) and the PDF analytics report (used by trackers and attendance events).
import type { Breakdown, TrackerAnalytics, TrackerGrid } from './types';
import { download, fmtDateTime, safeName } from './format';
import { DEFAULT_EXPECTED, fmtD, fmtShort, headline, hourLabel, pct, sumBy, totals } from './trackerStats';

type Cell = string | number | null;

function gridTable(grids: TrackerGrid[], contact: boolean, marks: string) {
  const multi = grids.length > 1;
  const dateKeys = [...new Set(grids.flatMap((g) => g.dates.filter((d) => !d.removed).map((d) => d.on_date)))].sort();
  const head = ['#', 'Name', ...(multi ? ['List'] : []), 'Voice', 'Area', 'District', 'Congregation', ...(contact ? ['Phone'] : []), ...dateKeys.map(fmtShort), 'Total'];
  const body: Cell[][] = [];
  for (const g of grids) {
    const idOf = new Map(g.dates.filter((d) => !d.removed).map((d) => [d.on_date, d.id]));
    for (const r of g.rows.filter((x) => !x.removed)) {
      const m = new Set(r.marks);
      const flags = dateKeys.map((k) => { const id = idOf.get(k); return id && m.has(id) ? marks : ''; });
      const total = dateKeys.filter((k) => { const id = idOf.get(k); return id && m.has(id); }).length;
      body.push([body.length + 1, [r.title, r.title_specify ? `(${r.title_specify})` : '', r.name].filter(Boolean).join(' '),
        ...(multi ? [g.list.title] : []), r.voice ?? '', r.area ?? '', r.district ?? '', r.congregation ?? '',
        ...(contact ? [r.contact ?? ''] : []), ...flags, total]);
    }
  }
  return { head, body, dateKeys };
}

export async function exportTrackerGrid(eventName: string, grids: TrackerGrid[], contact: boolean, format: 'xlsx' | 'pdf') {
  const title = grids.length === 1 ? grids[0]!.list.title : 'All lists';
  const name = safeName(`${eventName} - ${title}`);
  const { head, body } = gridTable(grids, contact, format === 'xlsx' ? '✓' : 'Yes');
  if (format === 'xlsx') {
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const data = [head.map((h) => ({ value: h, fontWeight: 'bold' as const })), ...body.map((r) => r.map((c) => (c === '' || c === null ? null : { value: c })))];
    const blob = await writeXlsxFile(data as never, {
      sheet: title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1',
      columns: head.map((h) => ({ width: h === 'Name' ? 28 : h === '#' ? 5 : 14 })), stickyRowsCount: 1,
    }).toBlob();
    download(blob, `${name}.xlsx`);
    return;
  }
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(16); doc.text(`${eventName} · ${title}`, 40, 44);
  doc.setFontSize(10); doc.setTextColor(110); doc.text(`${body.length} people · exported ${fmtDateTime(new Date().toISOString())}`, 40, 62);
  autoTable(doc, { startY: 76, head: [head], body: body.map((r) => r.map((c) => String(c ?? ''))), styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [31, 107, 255], textColor: 255 }, alternateRowStyles: { fillColor: [244, 246, 250] } });
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
  const W = doc.internal.pageSize.getWidth(), M = 40;
  doc.setFontSize(20); doc.setTextColor(20); doc.text(r.title, M, 52);
  doc.setFontSize(10); doc.setTextColor(110); doc.text(r.subtitle, M, 70);
  doc.setFontSize(11); doc.setTextColor(30);
  const hl = doc.splitTextToSize(r.headline, W - 2 * M) as string[];
  doc.text(hl, M, 96);
  let y = 96 + hl.length * 14 + 10;
  const bw = (W - 2 * M - 8 * (r.stats.length - 1)) / Math.max(1, r.stats.length);
  r.stats.forEach(([label, value], i) => {
    const x = M + i * (bw + 8);
    doc.setDrawColor(210); doc.roundedRect(x, y, bw, 46, 6, 6);
    doc.setFontSize(16); doc.setTextColor(20); doc.text(value, x + 8, y + 22);
    doc.setFontSize(7.5); doc.setTextColor(110); doc.text(doc.splitTextToSize(label, bw - 14) as string[], x + 8, y + 35);
  });
  y += 66;
  if (r.bars?.rows.length) {
    doc.setFontSize(12); doc.setTextColor(20); doc.text(r.bars.title, M, y); y += 12;
    for (const b of r.bars.rows) {
      if (y > 760) { doc.addPage(); y = 50; }
      doc.setFontSize(9); doc.setTextColor(60); doc.text(b.label, M, y + 8);
      doc.setFillColor(228, 231, 236); doc.rect(M + 90, y, W - 2 * M - 250, 9, 'F');
      doc.setFillColor(31, 107, 255); doc.rect(M + 90, y, Math.max(1, (W - 2 * M - 250) * Math.min(1, b.value / Math.max(1, b.of))), 9, 'F');
      doc.setTextColor(110); doc.text(b.text, W - M - 150, y + 8);
      y += 17;
    }
    y += 10;
  }
  for (const s of r.sections) {
    if (!s.body.length) continue;
    if (y > 720) { doc.addPage(); y = 50; }
    doc.setFontSize(12); doc.setTextColor(20); doc.text(s.title, M, y);
    autoTable(doc, { startY: y + 6, head: [s.head], body: s.body.map((row) => row.map((c) => String(c ?? ''))), styles: { fontSize: 8.5, cellPadding: 3 }, headStyles: { fillColor: [31, 107, 255], textColor: 255 }, alternateRowStyles: { fillColor: [244, 246, 250] }, margin: { left: M, right: M } });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 40) + 22;
    if (s.note) { doc.setFontSize(8); doc.setTextColor(120); doc.text(s.note, M, y - 10); }
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(140);
    doc.text(`Built by CrispinIT Labs · page ${i} of ${n}`, M, doc.internal.pageSize.getHeight() - 20);
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
