import { useState, type ReactNode } from 'react';
import { useLookups } from '../lib/auth';
import { contactOk, errMsg, formatContactInput } from '../lib/format';
import type { ProfileInput } from '../lib/types';
import { Alert, Field, Loading } from './ui';
import { DistrictInput } from './DistrictInput';

export const emptyProfile: ProfileInput = {
  title_id: null, title_specify: '', full_name: '', area_id: null, voice_part_id: null, district: '', contact: '', congregation: '',
};

export function PersonForm({ initial = emptyProfile, submitLabel, onSubmit, extra, nameOnly, compact, relaxed, voiceIds, areaIds, staff }: {
  initial?: ProfileInput; submitLabel: string; nameOnly?: boolean; compact?: boolean;
  /** Staff adding or editing someone: the title is optional and a congregation can be entered. Members signing up still choose a title. */
  staff?: boolean;
  /** Only the name is required (used when staff edit a sign-up entry). */
  relaxed?: boolean; voiceIds?: string[]; areaIds?: string[];
  onSubmit: (v: ProfileInput) => Promise<void>; extra?: ReactNode;
}) {
  const { areas, titles, voices, ready } = useLookups();
  const [v, setV] = useState<ProfileInput>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!ready) return <Loading />;
  const set = <K extends keyof ProfileInput>(k: K, val: ProfileInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const title = titles.find((t) => t.id === v.title_id);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (v.full_name.trim().length < 2) return setErr('Please enter the full name.');
    if (relaxed && !contactOk(v.contact)) return setErr('Contact must look like +260 977 123 456, or be left empty.');
    if (!nameOnly && !relaxed) {
      if (!staff && !v.title_id) return setErr('Please choose a title.');
      if (title?.needs_specify && !v.title_specify.trim()) return setErr(`Please say which ${title.name} (for example the office or role).`);
      if (!v.area_id) return setErr('Please choose an area.');
      if (!v.voice_part_id) return setErr('Please choose a voice part.');
      if (v.district.trim().length < 2) return setErr('Please enter the district.');
      if (!contactOk(v.contact)) return setErr('Contact must look like +260 977 123 456, or be left empty.');
    }
    setBusy(true);
    try { await onSubmit({ ...v, full_name: v.full_name.trim() }); }
    catch (e2) { setErr(errMsg(e2)); }
    finally { setBusy(false); }
  };

  return (
    <form className="stack" style={{ gap: 14 }} onSubmit={submit} noValidate>
      {!nameOnly && (
        <Field label={staff ? 'Title (optional)' : 'Title'}>
          <select className="input" value={v.title_id ?? ''} onChange={(e) => set('title_id', e.target.value || null)}>
            <option value="">Choose…</option>
            {titles.filter((t) => t.active || t.id === v.title_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      )}
      {title?.needs_specify && (
        <Field label={`Specify ${title.name.toLowerCase()}`}>
          <input className="input" placeholder="For example Evangelist" value={v.title_specify} maxLength={60} onChange={(e) => set('title_specify', e.target.value)} />
        </Field>
      )}
      <Field label="Full name">
        <input className="input" placeholder="First and last name" value={v.full_name} maxLength={80} autoComplete="name" onChange={(e) => set('full_name', e.target.value)} />
      </Field>
      {!nameOnly && (
        <>
          <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <div className="grow"><Field label="Area">
              <select className="input" value={v.area_id ?? ''} onChange={(e) => set('area_id', e.target.value || null)}>
                <option value="">Choose…</option>
                {areas.filter((a) => (a.active && (!areaIds?.length || areaIds.includes(a.id))) || a.id === v.area_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field></div>
            <div className="grow"><Field label="Voice part">
              <select className="input" value={v.voice_part_id ?? ''} onChange={(e) => set('voice_part_id', e.target.value || null)}>
                <option value="">Choose…</option>
                {voices.filter((a) => (a.active && (!voiceIds?.length || voiceIds.includes(a.id))) || a.id === v.voice_part_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field></div>
          </div>
          <Field label="District">
            <DistrictInput value={v.district} onChange={(d) => set('district', d)} compact={compact} />
          </Field>
          {staff && (
            <Field label="Congregation (optional)">
              <DistrictInput kind="congregation" value={v.congregation ?? ''} onChange={(d) => set('congregation', d)} compact />
            </Field>
          )}
          <Field label="Contact (optional)">
            <input className="input" inputMode="tel" value={v.contact} placeholder="+260 9XX XXX XXX" autoComplete="tel"
              onChange={(e) => set('contact', formatContactInput(e.target.value))} />
          </Field>
        </>
      )}
      {extra}
      {err && <Alert>{err}</Alert>}
      <button className="btn primary cta block" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
    </form>
  );
}

export function profileFromPerson(p: {
  title_id: string | null; title_specify: string | null; full_name: string; area_id: string | null;
  voice_part_id: string | null; contact: string | null;
}, district: string, congregation = ''): ProfileInput {
  return {
    title_id: p.title_id, title_specify: p.title_specify ?? '', full_name: p.full_name, area_id: p.area_id,
    voice_part_id: p.voice_part_id, district, contact: p.contact ?? '', congregation,
  };
}
