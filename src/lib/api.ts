import { supabase } from './supabase';
import type {
  Account, AccountStatus, AttendanceRow, AuditRow, Breakdown, DistrictGroup, EventRow, Grant, HistoryRow, ListRow,
  Lookup, OpenList, PasteResult, PasteRowIn, Person, PersonCard, PresentRow, ProfileInput, QrPayload,
  SignupDetailInfo, SignupEntry, SignupListRow, SignupMatch, SignupQrPayload, TeamMember,
} from './types';

async function fn(action: string, id: string) {
  const { data, error } = await supabase.functions.invoke('admin-create-user', { body: { action, id } });
  if (error) {
    let msg = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* keep */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data as { ok: true };
}

async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
async function must<T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as T;
}

const profileArgs = (p: ProfileInput) => ({
  p_title_id: p.title_id, p_title_specify: p.title_specify || null, p_full_name: p.full_name,
  p_area_id: p.area_id, p_voice_part_id: p.voice_part_id, p_district: p.district || null, p_contact: p.contact || null,
});

export const api = {
  // lookups
  areas: () => must<Lookup[]>(supabase.from('areas').select('*').order('sort').order('name')),
  titles: () => must<Lookup[]>(supabase.from('titles').select('*').order('sort').order('name')),
  voiceParts: () => must<Lookup[]>(supabase.from('voice_parts').select('*').order('sort').order('name')),
  saveLookup: async (table: 'areas' | 'titles' | 'voice_parts', row: Partial<Lookup> & { name: string }) => {
    const { id, ...rest } = row;
    const q = id ? supabase.from(table).update(rest).eq('id', id) : supabase.from(table).insert(rest);
    const { error } = await q;
    if (error) throw new Error(error.message.includes('duplicate') ? 'That name already exists.' : error.message);
  },
  deleteLookup: async (table: 'areas' | 'titles' | 'voice_parts', id: string) => {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) throw new Error(/foreign key|violates/i.test(error.message) ? 'It is in use, so it cannot be deleted. Switch it to inactive instead.' : error.message);
  },

  // accounts & profile
  myAccount: async (uid: string) => (await supabase.from('accounts').select('*').eq('id', uid).maybeSingle()).data as Account | null,
  myPerson: async (pid: string) => (await supabase.from('people').select('*').eq('id', pid).maybeSingle()).data as Person | null,
  saveMyProfile: (p: ProfileInput) => rpc('save_my_profile', profileArgs(p)),
  clearMustSetPassword: () => rpc('clear_must_set_password'),
  suggestDistricts: (q: string) => rpc<{ id: string; name: string }[]>('suggest_districts', { p_q: q }),
  myHistory: () => rpc<HistoryRow[]>('my_history'),

  // attendance
  openLists: () => rpc<OpenList[]>('get_open_lists'),
  markMine: (list: string, token: string, pos?: { lat: number; lng: number; accuracy: number }) =>
    rpc<{ status: string; list_title: string; attendance_id: string }>('mark_my_attendance', {
      p_list: list, p_token: token, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null, p_accuracy: pos?.accuracy ?? null,
    }),
  markManual: (list: string, person: string) => rpc<{ status: string; attendance_id: string }>('mark_attendance_manual', { p_list: list, p_person: person }),
  undo: (att: string) => rpc('undo_attendance', { p_att: att }),
  removeAtt: (att: string, reason: string) => rpc('remove_attendance', { p_att: att, p_reason: reason }),
  restoreAtt: (att: string) => rpc('restore_attendance', { p_att: att }),
  listPresent: (list: string, includeRemoved = false) => rpc<PresentRow[]>('list_present', { p_list: list, p_include_removed: includeRemoved }),
  qr: (list: string) => rpc<QrPayload>('get_qr_payload', { p_list: list }),

  // people
  searchPeople: (q: string, list: string | null) => rpc<PersonCard[]>('search_people', { p_q: q, p_list: list }),
  createPerson: (p: ProfileInput, force: boolean) =>
    rpc<{ status: 'similar'; matches: PersonCard[] } | { status: 'created'; id: string }>('create_person', { ...profileArgs(p), p_force: force }),
  updatePerson: (id: string, p: ProfileInput) => rpc('update_person', { p_id: id, ...profileArgs(p) }),
  archivePerson: (id: string) => rpc('archive_person', { p_id: id }),
  restorePerson: (id: string) => rpc('restore_person', { p_id: id }),
  deletePerson: (id: string) => rpc('delete_person', { p_id: id }),
  mergePeople: (keep: string, merge: string) => rpc('merge_people', { p_keep: keep, p_merge: merge }),
  allPeople: () => must<Person[]>(supabase.from('people').select('*').order('full_name')),

  // events & lists
  events: () => must<EventRow[]>(supabase.from('events').select('*').order('created_at', { ascending: false })),
  lists: () => must<ListRow[]>(supabase.from('lists').select('*').order('created_at', { ascending: false })),
  createEvent: (name: string) => rpc<string>('create_event', { p_name: name }),
  archiveEvent: (id: string) => rpc('archive_event', { p_id: id }),
  unarchiveEvent: (id: string) => rpc('unarchive_event', { p_id: id }),
  deleteEvent: (id: string, confirm: string) => rpc('delete_event', { p_id: id, p_confirm: confirm }),
  renameEvent: (id: string, name: string) => rpc('rename_event', { p_id: id, p_name: name }),
  saveList: (v: {
    id: string | null; event: string; title: string; allowed: string[]; location: boolean;
    lat: number | null; lng: number | null; radius: number; rotating: boolean; rotation: number;
  }) => rpc<string>('save_list', {
    p_id: v.id, p_event: v.event, p_title: v.title, p_allowed: v.allowed, p_location: v.location,
    p_lat: v.lat, p_lng: v.lng, p_radius: v.radius, p_rotating: v.rotating, p_rotation: v.rotation,
  }),
  openListById: (id: string) => rpc('open_list', { p_id: id }),
  closeList: (id: string) => rpc('close_list', { p_id: id }),
  archiveList: (id: string) => rpc('archive_list', { p_id: id }),
  unarchiveList: (id: string) => rpc('unarchive_list', { p_id: id }),
  deleteList: (id: string, confirm: string) => rpc('delete_list', { p_id: id, p_confirm: confirm }),
  listAttendance: async (list: string, includeRemoved: boolean) => {
    let q = supabase.from('attendance').select('*').eq('list_id', list).order('marked_at', { ascending: false });
    if (!includeRemoved) q = q.eq('removed', false);
    return must<AttendanceRow[]>(q);
  },
  eventAttendance: (listIds: string[]) =>
    must<AttendanceRow[]>(supabase.from('attendance').select('*').in('list_id', listIds).eq('removed', false)),
  breakdown: (event: string) => rpc<Breakdown[]>('event_breakdown', { p_event: event }),

  // accounts admin
  accounts: () => must<Account[]>(supabase.from('accounts').select('*').order('created_at', { ascending: false })),
  setDisabled: (id: string, disabled: boolean) => rpc('set_account_disabled', { p_id: id, p_disabled: disabled }),
  linkAccount: (account: string, person: string) => rpc('link_account_person', { p_account: account, p_person: person }),
  grants: () => must<Grant[]>(supabase.from('reviewer_grants').select('*')),
  grant: (account: string, event: string | null, list: string | null, signup: string | null = null) => rpc('grant_access', { p_account: account, p_event: event, p_list: list, p_signup: signup }),
  setScope: (id: string, scope: 'all' | 'selected') => rpc('set_account_scope', { p_id: id, p_scope: scope }),
  revokeGrant: (id: string) => rpc('revoke_grant', { p_id: id }),
  eventTeam: (event: string) => rpc<TeamMember[]>('event_team', { p_event: event }),
  signupTeam: (signup: string) => rpc<TeamMember[]>('signup_team', { p_signup: signup }),
  accountStatuses: () => rpc<AccountStatus[]>('account_statuses'),
  verifyAccount: (id: string) => fn('verify', id),
  resendInvite: (id: string) => fn('resend', id),
  deleteAccount: async (id: string) => {
    const { data, error } = await supabase.functions.invoke('admin-create-user', { body: { action: 'delete', id } });
    if (error) {
      let msg = error.message;
      try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* keep */ }
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data as { ok: true };
  },
  invite: async (v: { email: string; full_name: string; role: string; person_id?: string | null; scope?: 'all' | 'selected' }) => {
    const { data, error } = await supabase.functions.invoke('admin-create-user', { body: v });
    if (error) {
      let msg = error.message;
      try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* keep */ }
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data as { ok: true };
  },

  // districts / audit / exports
  districts: () => rpc<DistrictGroup[]>('district_overview'),
  renameDistrict: (id: string, name: string) => rpc('rename_district', { p_id: id, p_name: name }),
  mergeDistricts: (from: string, to: string) => rpc('merge_districts', { p_from: from, p_to: to }),
  audit: (limit = 300) => must<AuditRow[]>(supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(limit)),
  logExport: (scope: 'list' | 'event' | 'signup', target: string, format: string, details: Record<string, unknown> = {}) =>
    rpc('log_export', { p_scope: scope, p_target: target, p_format: format, p_details: details }),

  // sign-up lists
  signupLists: () => rpc<SignupListRow[]>('signup_lists_overview'),
  signupGet: (id: string) => rpc<SignupDetailInfo>('signup_get', { p_id: id }),
  signupSave: (v: {
    id: string | null; title: string; voices: string[]; areas: string[]; location: boolean;
    lat: number | null; lng: number | null; radius: number; rotating: boolean; rotation: number;
  }) => rpc<string>('signup_save', {
    p_id: v.id, p_title: v.title, p_voices: v.voices, p_areas: v.areas, p_location: v.location,
    p_lat: v.lat, p_lng: v.lng, p_radius: v.radius, p_rotating: v.rotating, p_rotation: v.rotation,
  }),
  signupQr: (id: string) => rpc<SignupQrPayload>('signup_qr_payload', { p_id: id }),
  signupSetOpen: (id: string, open: boolean) => rpc('signup_set_open', { p_id: id, p_open: open }),
  signupNewLink: (id: string) => rpc<string>('signup_new_link', { p_id: id }),
  signupDelete: (id: string, confirm: string) => rpc('signup_delete', { p_id: id, p_confirm: confirm }),
  signupEntries: (list: string, includeRemoved: boolean) =>
    rpc<SignupEntry[]>('signup_entries', { p_list: list, p_include_removed: includeRemoved }),
  signupPaste: (list: string, rows: PasteRowIn[], commit: boolean) =>
    rpc<PasteResult>('signup_paste', { p_list: list, p_rows: rows, p_commit: commit }),
  signupUpdate: (id: string, p: ProfileInput, force: boolean) =>
    rpc<{ status: 'saved' | 'similar' | 'already'; matches?: SignupMatch[] }>('signup_update_entry', { p_id: id, ...profileArgs(p), p_force: force }),
  signupRemove: (id: string, reason: string) => rpc('signup_remove_entry', { p_id: id, p_reason: reason }),
  signupDeleteEntry: (id: string) => rpc('signup_delete_entry', { p_id: id }),
  signupRestore: (id: string) => rpc('signup_restore_entry', { p_id: id }),
  signupToPerson: (id: string, force: boolean) =>
    rpc<{ status: 'similar'; matches: PersonCard[] } | { status: 'created'; id: string }>('signup_to_person', { p_entry: id, p_force: force }),
  signupMergeInto: (entry: string, person: string) => rpc('signup_merge_into', { p_entry: entry, p_person: person }),
};
