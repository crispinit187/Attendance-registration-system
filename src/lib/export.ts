// Excel and PDF export. Libraries are loaded only when an export is clicked.
import type { AttendanceRow, ListRow, SignupEntry } from './types';
import { download, fmtDateTime, safeName } from './format';

export interface ExportOptions { includeContact: boolean; includeMethod: boolean }
type Cell = string | number | null;

function columnsFor(o: ExportOptions) {
  const head = ['#', 'Name', 'Area', 'District', 'Voice part'];
  if (o.includeContact) head.push('Contact');
  head.push('Time marked');
  if (o.includeMethod) head.push('Marked by', 'Method');
  return head;
}
function rowsFor(rows: AttendanceRow[], o: ExportOptions): Cell[][] {
  const sorted = [...rows].sort((a, b) => (a.snapshot.full_name ?? '').localeCompare(b.snapshot.full_name ?? ''));
  return sorted.map((r, i) => {
    const s = r.snapshot;
    const row: Cell[] = [i + 1, s.display_name, s.area ?? '', s.district ?? '', s.voice_part ?? ''];
    if (o.includeContact) row.push(s.contact ?? '');
    row.push(fmtDateTime(r.marked_at));
    if (o.includeMethod) row.push(r.marked_by_name ?? '', r.method === 'self' ? 'Self (QR)' : r.method === 'registrar' ? 'Registrar' : 'Admin');
    return row;
  });
}

async function xlsx(sheetName: string, head: string[], body: Cell[][], widths: number[], file: string) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const data = [
    head.map((h) => ({ value: h, fontWeight: 'bold' as const })),
    ...body.map((r) => r.map((c) => (c === null || c === '' ? null : { value: c } ))),
  ];
  const blob = await writeXlsxFile(data as never, {
    sheet: sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1',
    columns: widths.map((width) => ({ width })),
    stickyRowsCount: 1,
  }).toBlob();
  download(blob, file);
}

async function pdf(title: string, subtitle: string, head: string[], body: Cell[][], file: string, landscape: boolean) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  doc.setFontSize(16); doc.text(title, 40, 44);
  doc.setFontSize(10); doc.setTextColor(110); doc.text(subtitle, 40, 62);
  autoTable(doc, {
    startY: 76, head: [head], body: body.map((r) => r.map((c) => String(c ?? ''))),
    styles: { fontSize: 8.5, cellPadding: 4 }, headStyles: { fillColor: [31, 107, 255], textColor: 255 },
    alternateRowStyles: { fillColor: [244, 246, 250] },
    didDrawPage: () => {
      doc.setFontSize(8); doc.setTextColor(130);
      doc.text(`Page ${doc.getNumberOfPages()}`, doc.internal.pageSize.getWidth() - 70, doc.internal.pageSize.getHeight() - 20);
    },
  });
  doc.save(file);
}

export async function exportList(list: { title: string; event?: string }, rows: AttendanceRow[], o: ExportOptions, format: 'xlsx' | 'pdf') {
  const head = columnsFor(o);
  const body = rowsFor(rows, o);
  const name = safeName(`${list.event ? list.event + ' - ' : ''}${list.title}`);
  const sub = `${list.event ? list.event + ' · ' : ''}${rows.length} present · exported ${fmtDateTime(new Date().toISOString())}`;
  if (format === 'xlsx') {
    await xlsx(list.title, head, body, head.map((h) => (h === 'Name' ? 28 : h === '#' ? 5 : 16)), `${name}.xlsx`);
  } else {
    await pdf(list.title, sub, head, body, `${name}.pdf`, head.length > 6);
  }
}

/** One row per person, one column per list, ✓ where present, plus a total. */
export async function exportEventGrid(eventName: string, lists: ListRow[], rows: AttendanceRow[], o: { includeContact: boolean }, format: 'xlsx' | 'pdf') {
  const ordered = [...lists].sort((a, b) => (a.opened_at ?? a.created_at).localeCompare(b.opened_at ?? b.created_at));
  const people = new Map<string, AttendanceRow['snapshot']>();
  const present = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!people.has(r.person_id)) people.set(r.person_id, r.snapshot);
    if (!present.has(r.person_id)) present.set(r.person_id, new Set());
    present.get(r.person_id)!.add(r.list_id);
  }
  const head = ['Name', 'Area', 'District', 'Voice part', ...(o.includeContact ? ['Contact'] : []), ...ordered.map((l) => l.title), 'Total'];
  const body: Cell[][] = [...people.entries()]
    .sort((a, b) => (a[1].full_name ?? '').localeCompare(b[1].full_name ?? ''))
    .map(([pid, s]) => {
      const set = present.get(pid)!;
      return [s.display_name, s.area ?? '', s.district ?? '', s.voice_part ?? '',
        ...(o.includeContact ? [s.contact ?? ''] : []),
        ...ordered.map((l) => (set.has(l.id) ? '✓' : '')), set.size];
    });
  const totals: Cell[] = ['Total present', '', '', '', ...(o.includeContact ? [''] : []),
    ...ordered.map((l) => rows.filter((r) => r.list_id === l.id).length), rows.length];
  const all = [...body, totals];
  const name = safeName(`${eventName} - all lists`);
  if (format === 'xlsx') {
    await xlsx(eventName, head, all, head.map((h, i) => (i === 0 ? 28 : h === 'Total' ? 8 : 16)), `${name}.xlsx`);
  } else {
    await pdf(eventName, `${ordered.length} lists · ${people.size} people · exported ${fmtDateTime(new Date().toISOString())}`,
      head, all.map((r) => r.map((c) => (c === '✓' ? 'Yes' : c))), `${name}.pdf`, true);
  }
}

/** A sign-up list: one row per person. */
export async function exportSignups(list: { title: string }, rows: SignupEntry[], o: { includeContact: boolean; includeSource: boolean }, format: 'xlsx' | 'pdf') {
  const head = ['#', 'Name', 'Area', 'District', 'Voice part'];
  if (o.includeContact) head.push('Contact');
  head.push('Signed up');
  if (o.includeSource) head.push('How');
  const src = (e: SignupEntry) => (e.source === 'public' ? 'QR or link' : e.source === 'paste' ? 'Pasted list' : 'Added by staff');
  const body: Cell[][] = [...rows].sort((a, b) => a.full_name.localeCompare(b.full_name)).map((e, i) => {
    const r: Cell[] = [i + 1, e.display_name, e.area ?? '', e.district ?? '', e.voice_part ?? ''];
    if (o.includeContact) r.push(e.contact ?? '');
    r.push(fmtDateTime(e.created_at));
    if (o.includeSource) r.push(src(e));
    return r;
  });
  const name = safeName(`${list.title} - sign-ups`);
  if (format === 'xlsx') {
    await xlsx(list.title, head, body, head.map((h) => (h === 'Name' ? 28 : h === '#' ? 5 : 16)), `${name}.xlsx`);
  } else {
    await pdf(list.title, `${rows.length} signed up · exported ${fmtDateTime(new Date().toISOString())}`, head, body, `${name}.pdf`, head.length > 6);
  }
}
