export type Role = 'admin' | 'reviewer' | 'registrar' | 'member';

export interface Account {
  id: string; email: string | null; full_name: string | null; role: Role;
  person_id: string | null; must_set_password: boolean; disabled: boolean; created_at: string;
}
export interface AccountStatus { id: string; verified_at: string | null; last_sign_in_at: string | null; invited_at: string | null }
export type AccountState = 'pending' | 'setup' | 'active' | 'disabled';
export interface Lookup { id: string; name: string; sort: number; active: boolean; needs_specify?: boolean }
export interface Person {
  id: string; title_id: string | null; title_specify: string | null; full_name: string;
  area_id: string | null; district_group_id: string | null; voice_part_id: string | null;
  contact: string | null; archived: boolean; created_at: string; merged_into: string | null;
}
export interface EventRow { id: string; name: string; created_at: string; archived_at: string | null }
export interface ListRow {
  id: string; event_id: string; title: string; status: 'draft' | 'open' | 'closed' | 'archived';
  allowed_area_ids: string[]; location_check: boolean; venue_lat: number | null; venue_lng: number | null;
  radius_m: number; rotating_qr: boolean; rotation_seconds: number;
  opened_at: string | null; closed_at: string | null; archived_at: string | null; created_at: string;
}
export interface Snapshot {
  person_id: string; title: string | null; title_specify: string | null; full_name: string;
  display_name: string; area_id: string | null; area: string | null; district: string | null;
  voice_part_id: string | null; voice_part: string | null; contact: string | null;
}
export interface AttendanceRow {
  id: string; list_id: string; person_id: string; method: 'self' | 'registrar' | 'admin';
  marked_by_name: string | null; marked_at: string; snapshot: Snapshot;
  removed: boolean; removed_at: string | null; removed_reason: string | null;
}
export interface OpenList {
  id: string; title: string; event_name: string; location_check: boolean; rotating_qr: boolean;
  radius_m: number; allowed_area_ids: string[]; present_count: number | null; opened_at: string;
}
export interface PersonCard {
  id: string; display_name: string; area: string | null; district: string | null;
  has_account: boolean; present: boolean; was_removed: boolean;
}
export interface PresentRow {
  att_id: string; person_id: string; display_name: string; area: string | null; district: string | null;
  voice_part: string | null; marked_at: string; method: string; marked_by: string | null;
  marked_by_name: string | null; removed: boolean; removed_reason: string | null;
}
export interface QrPayload {
  mode: 'rotating' | 'static'; token: string; list_id: string; title: string;
  seconds_left?: number; rotation_seconds?: number;
}
export interface Breakdown {
  list_id: string; title: string; status: string; opened_at: string | null; total: number;
  areas: Record<string, number>; voices: Record<string, number>; districts: Record<string, number>;
}
export interface Grant { id: string; account_id: string; event_id: string | null; list_id: string | null; created_at: string }
export interface AuditRow {
  id: number; at: string; actor_id: string | null; actor_name: string | null; action: string;
  target_type: string | null; target_id: string | null; details: Record<string, unknown>;
}
export interface DistrictGroup { id: string; name: string; people: number; variants: string[] }
export interface HistoryRow { id: string; list_id: string; list_title: string; event_name: string; marked_at: string }
export interface ProfileInput {
  title_id: string | null; title_specify: string; full_name: string; area_id: string | null;
  voice_part_id: string | null; district: string; contact: string;
}

// ---- Sign-up lists ----
export interface SignupListRow {
  id: string; title: string; status: 'open' | 'closed'; opened_at: string | null; created_at: string; entries: number;
}
export interface SignupDetailInfo {
  id: string; title: string; status: 'open' | 'closed'; code: string;
  voice_part_ids: string[]; allowed_area_ids: string[]; location_check: boolean;
  venue_lat: number | null; venue_lng: number | null; radius_m: number; opened_at: string | null; entries: number;
  rotating_qr: boolean; rotation_seconds: number;
}
export interface SignupQrPayload { code: string; seconds_left: number; rotation_seconds: number; title: string; entries: number }
export interface SignupEntry {
  id: string; display_name: string; title_id: string | null; title_specify: string | null; full_name: string;
  area_id: string | null; area: string | null; district: string | null;
  voice_part_id: string | null; voice_part: string | null; contact: string | null;
  source: 'public' | 'staff' | 'paste'; added_by_name: string | null; forced: boolean; created_at: string;
  removed: boolean; removed_reason: string | null; person_id: string | null; person_name: string | null; can_edit: boolean;
}
export interface SignupMatch { id: string; name: string; full_name: string; exact: boolean; same_district: boolean }
export interface PasteRowIn {
  title_id: string | null; title_specify: string; name: string; area_id: string | null;
  district: string; voice_part_id: string | null; contact: string; force: boolean;
}
export interface PasteResult {
  rows: { idx: number; status: 'new' | 'similar' | 'already' | 'invalid' | 'added' | 'skipped'; message: string | null }[];
  new: number; added: number; similar: number; already: number; invalid: number;
}
export interface JoinInfo {
  title: string; open: boolean; location_check: boolean;
  /** Only for rotating lists: lets the visitor take a few minutes to fill the form. */
  ticket?: string | null;
  titles: { id: string; name: string; needs_specify: boolean }[];
  areas: { id: string; name: string }[];
  voices: { id: string; name: string }[];
}
export type JoinResult =
  | { status: 'created' | 'already'; title: string }
  | { status: 'similar'; match: string };
