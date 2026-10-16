export const fmtDateTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
export const fmtTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
export const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

/** Turn what someone typed into +260 xxx xxx xxx while they type. */
export function formatContactInput(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('260')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  d = d.slice(0, 9);
  if (!d) return raw.trim() === '+' ? '+' : '';
  const parts = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean);
  return '+260 ' + parts.join(' ');
}
export const contactOk = (c: string) => c === '' || /^\+260 \d{3} \d{3} \d{3}$/.test(c);

export function errMsg(e: unknown): string {
  if (!e) return 'Something went wrong.';
  if (typeof e === 'string') return e;
  const m = (e as { message?: string }).message;
  if (!m) return 'Something went wrong.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Could not reach the server. Check your internet and try again.';
  if (/JWT|not authenticated/i.test(m)) return 'Your session expired. Please sign in again.';
  return m;
}
export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'export';

export const displayName = (title?: string | null, specify?: string | null, name?: string | null) =>
  [title, specify && specify.trim() ? `(${specify.trim()})` : '', name].filter(Boolean).join(' ');
export const fmtLongDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : '';
