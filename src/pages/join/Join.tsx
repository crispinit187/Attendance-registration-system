import { useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { joinApi, type JoinForm, type Position } from '../../lib/join';
import { contactOk, errMsg, formatContactInput } from '../../lib/format';
import type { JoinInfo } from '../../lib/types';
import { Alert, BrandLabel, Icon, Loading } from '../../components/ui';
import { Turnstile, turnstileEnabled } from '../../components/Turnstile';

const empty: JoinForm = { title_id: null, title_specify: '', full_name: '', area_id: null, voice_part_id: null, district: '', contact: '' };

type Outcome = { kind: 'created' | 'already'; name: string } | { kind: 'similar'; match: string } | null;

function getPosition(): Promise<Position> {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('This browser cannot share its location, which this sign-up needs.'));
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => rej(new Error('Location is needed for this sign-up. Please allow location access and try again.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}

const friendly = (e: unknown) => {
  const m = errMsg(e);
  return /captcha/i.test(m) ? 'The human check failed. Please try again.' : m;
};

/** The public sign-up page: opened from the QR code or the shared link. No account needed. */
export function Join() {
  const { code = '' } = useParams();
  // A rotating list gives the page a ticket on the first load. It is used from then on, so the
  // visitor can take a few minutes over the form after the screen's code has moved on.
  const ticket = useRef<string | null>(null);
  const info = useQuery({
    queryKey: ['join-info', code],
    queryFn: async () => { const r = await joinApi.info(ticket.current ?? code); if (r.ticket) ticket.current = r.ticket; return r; },
    refetchInterval: 20_000, retry: false,
  });
  const [f, setF] = useState<JoinForm>(empty);
  const [token, setToken] = useState<string | null>(null);
  const [reset, setReset] = useState(0);
  const [hasSession, setHasSession] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [out, setOut] = useState<Outcome>(null);
  const set = <K extends keyof JoinForm>(k: K, v: JoinForm[K]) => setF((p) => ({ ...p, [k]: v }));

  const send = async (d: JoinInfo, force: boolean) => {
    setErr('');
    const title = d.titles.find((t) => t.id === f.title_id);
    if (!f.title_id) return setErr('Please choose your title.');
    if (title?.needs_specify && !f.title_specify.trim()) return setErr(`Please say which ${title.name} you are (for example Evangelist).`);
    if (f.full_name.trim().length < 2) return setErr('Please enter your full name.');
    if (!f.area_id) return setErr('Please choose your area.');
    if (f.district.trim().length < 2) return setErr('Please enter your district.');
    if (!f.voice_part_id) return setErr('Please choose your voice part.');
    if (!contactOk(f.contact)) return setErr('Contact must look like +260 977 123 456, or be left empty.');
    if (turnstileEnabled && !hasSession && !token) return setErr('Please wait for the human check to finish, then try again.');
    setBusy(true);
    try {
      const pos = d.location_check ? await getPosition() : null;
      const r = await joinApi.submit(ticket.current ?? code, { ...f, full_name: f.full_name.trim(), district: f.district.trim() }, token, pos, force);
      setHasSession(true);
      if (r.status === 'similar') setOut({ kind: 'similar', match: r.match });
      else setOut({ kind: r.status, name: f.full_name.trim() });
    } catch (e) {
      setErr(friendly(e));
      setReset((n) => n + 1);                       // a human-check token can only be used once
      void joinApi.hasSession().then(setHasSession);
    } finally { setBusy(false); }
  };

  const again = () => { setF(empty); setOut(null); setErr(''); };
  const d = info.data;

  return (
    <div className="auth-wrap">
      <div className="auth-card stack" style={{ gap: 18 }}>
        <BrandLabel short size={30} />

        {info.isLoading ? <Loading /> : info.error || !d ? (
          <div className="card bigstate">
            <div className="ico warn"><Icon name="lock" size={22} /></div>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>This link is not working</div>
            <div className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>{info.error ? errMsg(info.error) : 'Please ask for the current link or QR code.'}</div>
          </div>
        ) : (
          <>
            <div className="stack" style={{ gap: 8 }}>
              <div><span className={`statusline ${d.open ? 'ok' : 'warn'}`}>{d.open ? 'Sign-ups open' : 'Sign-ups closed'}</span></div>
              <h1 className="joinhead">{d.title}</h1>
              <p className="auth-sub">{d.open ? 'Type your details to sign up. No account needed.' : 'This list is not taking sign-ups right now.'}</p>
            </div>

            {!d.open ? (
              <>
                <div className="card bigstate">
                  <div className="ico warn"><Icon name="lock" size={22} /></div>
                  <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Sign-ups are closed</div>
                  <div className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>If you still need to sign up, ask your registrar or an admin to open the list.</div>
                </div>
                <p className="muted center" style={{ fontSize: 12, margin: 0 }}>The same link works again as soon as an admin opens sign-ups.</p>
              </>
            ) : out && out.kind !== 'similar' ? (
              <div className="card bigstate">
                <div className="ico ok"><Icon name="check" size={24} /></div>
                <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 6 }}>{out.kind === 'created' ? 'You are signed up' : 'You are already on the list'}</div>
                <div className="muted" style={{ fontSize: 14, lineHeight: 1.55, marginBottom: 16 }}>
                  {out.kind === 'created'
                    ? `Thank you, ${out.name.split(/\s+/)[0]}. Your details were added to ${d.title}.`
                    : `Someone with this name is already signed up for ${d.title}, so there is nothing more to do.`}
                </div>
                <button className="btn block" onClick={again}>Sign up someone else</button>
              </div>
            ) : (
              <form className="stack" style={{ gap: 14 }} noValidate onSubmit={(e) => { e.preventDefault(); void send(d, false); }}>
                {d.location_check && <Alert kind="info">This sign-up checks that you are near the venue, so your phone will ask to share its location.</Alert>}

                <div className="field">
                  <span>Title</span>
                  <div className="choices">
                    {d.titles.map((t) => (
                      <button type="button" key={t.id} className={`choice round ${f.title_id === t.id ? 'on' : ''}`} aria-pressed={f.title_id === t.id}
                        onClick={() => set('title_id', t.id)}>{t.name}</button>
                    ))}
                  </div>
                </div>
                {d.titles.find((t) => t.id === f.title_id)?.needs_specify && (
                  <label className="field"><span>Which {d.titles.find((t) => t.id === f.title_id)!.name.toLowerCase()}?</span>
                    <input className="input" placeholder="For example Evangelist" maxLength={60} value={f.title_specify} onChange={(e) => set('title_specify', e.target.value)} />
                  </label>
                )}

                <label className="field"><span>Full name</span>
                  <input className="input" placeholder="First and last name" maxLength={80} autoComplete="name" value={f.full_name} onChange={(e) => set('full_name', e.target.value)} />
                </label>

                <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <label className="field grow"><span>Area</span>
                    <select className="input" value={f.area_id ?? ''} onChange={(e) => set('area_id', e.target.value || null)}>
                      <option value="">Choose…</option>
                      {d.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </label>
                  <label className="field grow"><span>District</span>
                    <input className="input" placeholder="Type it in" maxLength={60} autoComplete="off" value={f.district} onChange={(e) => set('district', e.target.value)} />
                  </label>
                </div>

                <div className="field">
                  <span>Voice part</span>
                  <div className="choices two">
                    {d.voices.map((v) => (
                      <button type="button" key={v.id} className={`choice ${f.voice_part_id === v.id ? 'on' : ''}`} aria-pressed={f.voice_part_id === v.id}
                        onClick={() => set('voice_part_id', v.id)}>{v.name}</button>
                    ))}
                  </div>
                </div>

                <label className="field"><span>Contact (optional)</span>
                  <input className="input" inputMode="tel" placeholder="+260 9XX XXX XXX" autoComplete="tel" value={f.contact}
                    onChange={(e) => set('contact', formatContactInput(e.target.value))} />
                </label>

                {out?.kind === 'similar' && (
                  <div className="alert info stack" style={{ gap: 10 }}>
                    <div><b>A very similar name is already on this list:</b> {out.match}</div>
                    <div className="muted" style={{ fontSize: 14 }}>If that is you, you are already signed up and need to do nothing more.</div>
                    <div className="row">
                      <button type="button" className="btn primary" disabled={busy} onClick={() => setOut({ kind: 'already', name: f.full_name.trim() })}>That is me</button>
                      <button type="button" className="btn" disabled={busy} onClick={() => void send(d, true)}>I am a different person</button>
                    </div>
                  </div>
                )}

                {!hasSession && <Turnstile onToken={setToken} resetKey={reset} />}
                {err && <Alert>{err}</Alert>}
                <button className="btn primary cta block" disabled={busy}>{busy ? 'Signing you up…' : 'Sign up'}</button>
                <p className="muted center" style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>Names are checked automatically so nobody is counted twice.</p>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
