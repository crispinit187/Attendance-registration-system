import { useState } from 'react';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/auth';
import { errMsg } from '../../lib/format';
import type { SignupDetailInfo } from '../../lib/types';
import { Alert, Field, Icon, Modal } from '../../components/ui';

/** Create or edit a sign-up list. The only things set here: the title, which voice parts are offered, and optional limits. */
export function SignupForm({ list, onClose, onSaved }: { list: SignupDetailInfo | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { areas, voices } = useLookups();
  const [title, setTitle] = useState(list?.title ?? '');
  const [vs, setVs] = useState<string[]>(list?.voice_part_ids ?? []);
  const [allowed, setAllowed] = useState<string[]>(list?.allowed_area_ids ?? []);
  const [loc, setLoc] = useState(list?.location_check ?? false);
  const [lat, setLat] = useState(list?.venue_lat?.toString() ?? '');
  const [lng, setLng] = useState(list?.venue_lng?.toString() ?? '');
  const [radius, setRadius] = useState(String(list?.radius_m ?? 200));
  const [rotating, setRotating] = useState(list?.rotating_qr ?? false);
  const [rotation, setRotation] = useState(String(list?.rotation_seconds ?? 30));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const flip = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  const here = () => {
    if (!navigator.geolocation) return setErr('This browser cannot share its location.');
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)); setErr(''); },
      () => setErr('Could not get this device\'s location. Type the coordinates instead.'),
      { enableHighAccuracy: true, timeout: 15000 });
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    if (title.trim().length < 2) return setErr('Please enter a title.');
    const la = lat.trim() === '' ? null : Number(lat), ln = lng.trim() === '' ? null : Number(lng);
    if (loc && (la === null || ln === null || Number.isNaN(la) || Number.isNaN(ln))) return setErr('Set the venue location (use “Use my location now” while at the venue), or turn the location check off.');
    const r = Number(radius);
    if (!(r >= 20 && r <= 5000)) return setErr('Radius must be between 20 and 5000 metres.');
    const rot = Number(rotation);
    if (rotating && !(rot >= 10 && rot <= 600)) return setErr('The code can change every 10 to 600 seconds.');
    setBusy(true);
    try {
      const id = await api.signupSave({ id: list?.id ?? null, title: title.trim(), voices: vs, areas: allowed, location: loc, lat: loc ? la : null, lng: loc ? ln : null, radius: r, rotating, rotation: rotating ? rot : 30 });
      onSaved(id);
    } catch (x) { setErr(errMsg(x)); setBusy(false); }
  };

  return (
    <Modal title={list ? 'Sign-up settings' : 'New sign-up list'} onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Title" hint="Shown at the top of the public sign-up page, for example “Choir rehearsal, 18 October”."><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} autoFocus /></Field>
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">Voice parts people can choose</b>
          <label className="check"><input type="checkbox" checked={vs.length === 0} onChange={() => setVs([])} />All voice parts</label>
          {voices.filter((v) => v.active).map((v) => <label className="check" key={v.id}><input type="checkbox" checked={vs.includes(v.id)} onChange={() => setVs(flip(vs, v.id))} />{v.name}</label>)}
          <span className="hint">Tick specific voice parts to offer only those.</span>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">Who can sign up</b>
          <label className="check"><input type="checkbox" checked={allowed.length === 0} onChange={() => setAllowed([])} />Every area</label>
          {areas.filter((a) => a.active).map((a) => <label className="check" key={a.id}><input type="checkbox" checked={allowed.includes(a.id)} onChange={() => setAllowed(flip(allowed, a.id))} />{a.name} only</label>)}
        </div>
        <label className="check"><input type="checkbox" checked={loc} onChange={(e) => setLoc(e.target.checked)} />
          <span><b>Location check</b><br /><span className="hint">People must be near the venue when they sign up. Applies to the QR code and the shared link alike.</span></span></label>
        {loc && (
          <div className="stack">
            <button type="button" className="btn small" onClick={here}><Icon name="pin" size={16} />Use my location now</button>
            <div className="grid c2">
              <Field label="Latitude"><input className="input" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} /></Field>
              <Field label="Longitude"><input className="input" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} /></Field>
            </div>
            <Field label="Allowed distance from the venue (metres)"><input className="input" inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value.replace(/\D/g, ''))} /></Field>
          </div>
        )}
        <label className="check"><input type="checkbox" checked={rotating} onChange={(e) => setRotating(e.target.checked)} />
          <span><b>Rotating QR code</b><br /><span className="hint">The code changes by itself and is shown live on a screen at the venue. A photo or a forwarded link stops working, so people have to be there. The shared link is not available for this kind of list.</span></span></label>
        {rotating && (
          <Field label="Change the code every (seconds)" hint="10 to 600. Thirty is a good start."><input className="input" inputMode="numeric" value={rotation} onChange={(e) => setRotation(e.target.value.replace(/\D/g, ''))} /></Field>
        )}
        {err && <Alert>{err}</Alert>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </Modal>
  );
}
