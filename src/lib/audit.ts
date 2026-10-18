import type { AuditRow } from './types';

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const grantWhat = (d: Record<string, unknown>) => d.tracker_event_id ? 'Whole tracker event' : d.tracker_list_id ? 'One tracker list' : d.event_id ? 'Whole event' : d.signup_list_id ? 'One sign-up list' : 'One list';

/** Turns an audit row into a sentence like the mockup: "<who> <what>" plus a detail line. */
export function describeAudit(r: AuditRow): { what: string; why: string } {
  const d = r.details as Record<string, unknown>;
  switch (r.action) {
    case 'attendance.remove': return { what: `removed ${s(d.person)} from ${s(d.list_title)}`, why: d.reason ? `Reason: ${s(d.reason)}` : '' };
    case 'attendance.restore': return { what: `restored ${s(d.person)} on ${s(d.list_title)}`, why: '' };
    case 'account.verify': return { what: `verified the email of ${s(d.email)} by hand`, why: '' };
    case 'account.scope': return { what: `${d.scope === 'all' ? 'gave access to everything' : 'limited access to selected items'} for ${s(d.email)} (${s(d.role)})`, why: '' };
    case 'account.role': return { what: `changed the role of ${s(d.email)} from ${s(d.from)} to ${s(d.to)}`, why: Number(d.access_removed) > 0 ? `${s(d.access_removed)} access item(s) the new role cannot use were removed` : '' };
    case 'account.resend': return { what: `sent the invitation again to ${s(d.email)}`, why: '' };
    case 'account.delete': return { what: `deleted the account ${s(d.email)} (${s(d.role)})`, why: '' };
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
    case 'event.archive': return { what: `archived the event ${s(d.name)}`, why: '' };
    case 'event.unarchive': return { what: `restored the event ${s(d.name)} from the archive`, why: '' };
    case 'event.delete': return { what: `deleted the event ${s(d.name)}`, why: `${s(d.lists)} list(s) and ${s(d.attendance_records)} attendance records were deleted with it` };
    case 'signup.delete_entry': return { what: `permanently deleted a removed entry from the sign-ups of ${s(d.title)}`, why: 'Details of the person are not kept' };
    case 'event.create': return { what: `created the event ${s(d.name)}`, why: '' };
    case 'export': return { what: `exported ${s(d.name)} (${s(d.format).toUpperCase()})`, why: d.contact ? 'Contact numbers included' : 'Contact numbers left out' };
    case 'account.create': return { what: `created a ${s(d.role)} account for ${s(d.email)}`, why: '' };
    case 'account.disable': return { what: `disabled the account of ${s(d.email)}`, why: '' };
    case 'account.enable': return { what: `enabled the account of ${s(d.email)}`, why: '' };
    case 'account.link': return { what: `linked the account of ${s(d.email)} to a person`, why: '' };
    case 'grant.add': return { what: `gave ${s(d.email)} access`, why: grantWhat(d) };
    case 'grant.remove': return { what: 'removed an access grant', why: grantWhat(d) };
    case 'tracker.event.create': return { what: `created the tracker event ${s(d.name)}`, why: '' };
    case 'tracker.event.rename': return { what: `renamed the tracker event ${s(d.from)} to ${s(d.to)}`, why: '' };
    case 'tracker.event.delete': return { what: `deleted the tracker event ${s(d.name)}`, why: 'Its lists and ticks were deleted with it' };
    case 'tracker.list.create': return { what: `added the tracker list ${s(d.title)}`, why: '' };
    case 'tracker.list.edit': return { what: `changed the tracker list ${s(d.title)}`, why: '' };
    case 'tracker.list.delete': return { what: `deleted the tracker list ${s(d.title)}`, why: '' };
    case 'tracker.date.add': return { what: `added the date ${s(d.date)}${d.title ? ` (${s(d.title)})` : ''} to ${s(d.list_title)}`, why: Number(d.lists) > 1 ? `Added to ${s(d.lists)} lists` : '' };
    case 'tracker.date.edit': return { what: `changed a date on ${s(d.list_title)}`, why: '' };
    case 'tracker.date.remove': return { what: `removed the date ${s(d.date)} from ${s(d.list_title)}`, why: 'Ticks are kept and come back if the date is restored' };
    case 'tracker.date.restore': return { what: `restored the date ${s(d.date)} on ${s(d.list_title)}`, why: '' };
    case 'tracker.entry.add': return { what: `added ${s(d.person)} to ${s(d.list_title)}`, why: '' };
    case 'tracker.entry.remove': return { what: `removed ${s(d.person)} from ${s(d.list_title)}`, why: '' };
    case 'tracker.entry.restore': return { what: `restored ${s(d.person)} on ${s(d.list_title)}`, why: '' };
    case 'tracker.person.create': return { what: `registered a new person, ${s(d.person)}, on ${s(d.list_title)}`, why: '' };
    case 'tracker.import': return { what: `imported a spreadsheet (${s(d.rows)} rows)`, why: `${s(d.new_people)} new people, ${s(d.existing_people)} already known, ${s(d.added_to_list)} added to lists${d.date ? `, ticked for ${s(d.date)}` : ''}` };
    case 'congregation.rename': return { what: `renamed congregation ${s(d.from)} to ${s(d.to)}`, why: '' };
    case 'congregation.merge': return { what: `merged congregation ${s(d.merged)} into ${s(d.into)}`, why: '' };
    case 'congregation.delete': return { what: `deleted the congregation ${s(d.name)}`, why: '' };
    case 'person.not_duplicate': return { what: 'marked two people as not the same person', why: '' };
    case 'person.archive': return { what: `archived ${s(d.person)}`, why: '' };
    case 'person.restore': return { what: `restored ${s(d.person)}`, why: '' };
    case 'person.delete': return { what: `deleted ${s(d.person)}`, why: '' };
    case 'person.merge': return { what: `merged ${s(d.merged)} into ${s(d.kept)}`, why: '' };
    case 'late_mark.approve': return { what: `approved a late mark for ${s(d.person)} on ${s(d.list_title)}`, why: `Marked by ${s(d.marked_by)} at ${s(d.at)}` };
    case 'late_mark.reject': return { what: `rejected a late mark for ${s(d.person)} on ${s(d.list_title)}`, why: `Marked by ${s(d.marked_by)}` };
    case 'action.undo': return { what: `undid: ${s(d.what)}`, why: '' };
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
