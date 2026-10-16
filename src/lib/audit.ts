import type { AuditRow } from './types';

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Turns an audit row into a sentence like the mockup: "<who> <what>" plus a detail line. */
export function describeAudit(r: AuditRow): { what: string; why: string } {
  const d = r.details as Record<string, unknown>;
  switch (r.action) {
    case 'attendance.remove': return { what: `removed ${s(d.person)} from ${s(d.list_title)}`, why: d.reason ? `Reason: ${s(d.reason)}` : '' };
    case 'attendance.restore': return { what: `restored ${s(d.person)} on ${s(d.list_title)}`, why: '' };
    case 'attendance.undo': return { what: `undid a mark for ${s(d.person)} on ${s(d.list_title)}`, why: '' };
    case 'list.open': return { what: `opened ${s(d.title)}`, why: '' };
    case 'list.close': return { what: `closed ${s(d.title)}`, why: '' };
    case 'list.create': return { what: `created the list ${s(d.title)}`, why: '' };
    case 'list.archive': return { what: `archived ${s(d.title)}`, why: '' };
    case 'list.unarchive': return { what: `restored ${s(d.title)} from the archive`, why: '' };
    case 'list.delete': return { what: `deleted the list ${s(d.title)}`, why: `${s(d.attendance_records)} attendance records were deleted with it` };
    case 'signup.create': return { what: `created the sign-up list ${s(d.title)}`, why: '' };
    case 'signup.open': return { what: `opened sign-ups for ${s(d.title)}`, why: '' };
    case 'signup.close': return { what: `closed sign-ups for ${s(d.title)}`, why: '' };
    case 'signup.newlink': return { what: `made a new sign-up link for ${s(d.title)}`, why: 'The old link and QR code stopped working' };
    case 'signup.delete': return { what: `deleted the sign-up list ${s(d.title)}`, why: `${s(d.entries)} entries were deleted with it` };
    case 'signup.paste': return { what: `added ${s(d.added)} people to ${s(d.title)} from a pasted list`, why: '' };
    case 'signup.remove_entry': return { what: `removed ${s(d.person)} from the sign-ups of ${s(d.title)}`, why: d.reason ? `Reason: ${s(d.reason)}` : '' };
    case 'signup.restore_entry': return { what: `restored ${s(d.person)} on the sign-ups of ${s(d.title)}`, why: '' };
    case 'signup.convert': return { what: `added ${s(d.person)} to people from the sign-ups of ${s(d.list)}`, why: '' };
    case 'signup.merge': return { what: `attached the sign-up of ${s(d.entry)} to ${s(d.person)}`, why: `From ${s(d.list)}` };
    case 'event.create': return { what: `created the event ${s(d.name)}`, why: '' };
    case 'export': return { what: `exported ${s(d.name)} (${s(d.format).toUpperCase()})`, why: d.contact ? 'Contact numbers included' : 'Contact numbers left out' };
    case 'account.create': return { what: `created a ${s(d.role)} account for ${s(d.email)}`, why: '' };
    case 'account.disable': return { what: `disabled the account of ${s(d.email)}`, why: '' };
    case 'account.enable': return { what: `enabled the account of ${s(d.email)}`, why: '' };
    case 'account.link': return { what: `linked the account of ${s(d.email)} to a person`, why: '' };
    case 'grant.add': return { what: `gave ${s(d.email)} reviewer access`, why: d.event_id ? 'Whole event' : 'One list' };
    case 'grant.remove': return { what: 'removed a reviewer access grant', why: '' };
    case 'person.archive': return { what: `archived ${s(d.person)}`, why: '' };
    case 'person.restore': return { what: `restored ${s(d.person)}`, why: '' };
    case 'person.delete': return { what: `deleted ${s(d.person)}`, why: '' };
    case 'person.merge': return { what: `merged ${s(d.merged)} into ${s(d.kept)}`, why: '' };
    case 'district.rename': return { what: `renamed district ${s(d.from)} to ${s(d.to)}`, why: '' };
    case 'district.merge': return { what: `merged district ${s(d.merged)} into ${s(d.into)}`, why: '' };
    default: return { what: r.action.replace('.', ' '), why: Object.entries(d).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${k}: ${s(v)}`).join(' · ') };
  }
}

export function fmtWhen(iso: string) {
  const t = new Date(iso); const now = new Date();
  const hm = t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(t.toDateString()).getTime()) / 86400000);
  if (days === 0) return `Today, ${hm}`;
  if (days === 1) return `Yesterday, ${hm}`;
  return t.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + `, ${hm}`;
}
