import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { errMsg } from '../../lib/format';
import { Alert, Icon, Logo } from '../../components/ui';
import { Turnstile, turnstileEnabled } from '../../components/Turnstile';

type Mode = 'in' | 'up' | 'forgot';
type Step = 'account' | 'verify';

const HEAD: Record<Mode, [string, string]> = {
  in: ['Welcome back', 'Sign in to mark your attendance or open your dashboard.'],
  up: ['Create your account', 'Sign up once. After that, scanning the QR code is all it takes.'],
  forgot: ['Reset your password', 'Enter your email and we will send you a link.'],
};

const FEATURES = [
  { icon: 'scan', title: 'Scan to mark present', body: 'Scan the QR code at the venue. Done in a few seconds, from your own phone.' },
  { icon: 'users', title: 'No phone? No problem', body: 'Registrars can mark people at the door, with duplicate checks built in.' },
  { icon: 'log', title: 'Sign-up lists', body: 'New people join with a QR code or link. No account needed.' },
  { icon: 'chart', title: 'Reports you can trust', body: 'Counts by area, district and voice part, with exports and an audit log.' },
] as const;
const STEPS = [
  { title: 'Create your account', body: 'An email and a password of at least 8 characters.' },
  { title: 'Verify your email', body: 'Open the link we send you. This keeps fake accounts out.' },
  { title: 'Add your details', body: 'Title, name, area, district and voice part, so registrars see the right information.' },
];

/** The context list. Beside the form on a computer, under the form on a phone. */
function LandList({ signup }: { signup: boolean }) {
  return signup ? (
    <div className="land-list steps3">
      {STEPS.map((s, i) => (
        <div className="li" key={s.title}><div className="ico round">{i + 1}</div><div><b>{s.title}</b><span className="d">{s.body}</span></div></div>
      ))}
    </div>
  ) : (
    <div className="land-list">
      {FEATURES.map((f) => (
        <div className="li" key={f.title}><div className="ico"><Icon name={f.icon} size={20} /></div><div><b>{f.title}</b><span className="d">{f.body}</span></div></div>
      ))}
    </div>
  );
}

export function SignupSteps({ at }: { at: 0 | 1 | 2 }) {
  return (
    <div className="steps" aria-label="Sign-up progress">
      {['Account', 'Verify', 'Details'].map((l, i) => (
        <div key={l} className={i === at ? 'on' : i < at ? 'done' : ''}><i />{l}</div>
      ))}
    </div>
  );
}

export function Login() {
  const [mode, setMode] = useState<Mode>('in');
  const [step, setStep] = useState<Step>('account');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [reset, setReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [done, setDone] = useState('');

  const go = (m: Mode) => { setMode(m); setStep('account'); setErr(''); setInfo(''); setDone(''); setReset((n) => n + 1); };
  const verifying = mode === 'up' && step === 'verify';
  const [h1, sub] = verifying ? ['Verify your email', 'This keeps fake accounts out. It only takes a moment.'] : HEAD[mode];

  const friendly = (e: unknown) => {
    const m = errMsg(e);
    return /invalid login/i.test(m) ? 'Wrong email or password.'
      : /email not confirmed/i.test(m) ? 'We have not seen your confirmation yet. Open the link in your email, then try again.'
      : /captcha/i.test(m) ? 'The human check failed. Please try again.'
      : /rate|too many|seconds/i.test(m) ? 'Too many tries. Please wait a minute and try again.'
      : m;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setDone('');
    const em = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(em)) return setErr('Please enter a valid email address.');
    if (mode !== 'forgot' && pw.length < 8) return setErr('Your password must be at least 8 characters.');
    if (mode === 'up' && pw !== pw2) return setErr('The two passwords do not match.');
    if (turnstileEnabled && !token) return setErr('Please wait for the human check to finish, then try again.');
    setBusy(true);
    try {
      const captchaToken = token ?? undefined;
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: em, password: pw, options: { captchaToken } });
        if (error) throw error;
      } else if (mode === 'up') {
        const { data, error } = await supabase.auth.signUp({ email: em, password: pw, options: { captchaToken } });
        if (error) throw error;
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          throw new Error('An account with this email already exists. Try signing in or resetting your password.');
        }
        if (data.session) return; // email confirmation switched off: already signed in
        setStep('verify'); setInfo('');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(em, { captchaToken });
        if (error) throw error;
        setDone('If the address belongs to an account, a link to choose a new password will arrive shortly.');
      }
    } catch (e2) { setErr(friendly(e2)); }
    finally { setBusy(false); setReset((n) => n + 1); }
  };

  const iVerified = async () => {
    setErr(''); setInfo(''); setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw, options: { captchaToken: token ?? undefined } });
      if (error) throw error;
    } catch (e) { setErr(friendly(e)); setReset((n) => n + 1); }
    finally { setBusy(false); }
  };
  const resend = async () => {
    setErr(''); setInfo('');
    if (turnstileEnabled && !token) return setErr('Please wait for the human check to finish, then try again.');
    setBusy(true);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { captchaToken: token ?? undefined } });
      if (error) throw error;
      setInfo('Sent again. Check your inbox.');
    } catch (e) { setErr(friendly(e)); }
    finally { setBusy(false); setReset((n) => n + 1); }
  };

  return (
    <div className="landing">
      <aside className="land-hero">
        <div className="land-brand"><Logo size={36} /><div>Attendance<br />Registration System</div></div>
        <h2>{mode === 'up' ? 'Set up once. After that, scanning is all it takes.' : 'Take attendance in seconds, not in notebooks.'}</h2>
        <p>{mode === 'up' ? 'Your account keeps your attendance history in one place.' : 'One place to mark who was there, sign up new people and keep an honest record for every event.'}</p>
        <LandList signup={mode === 'up'} />
      </aside>
      <main className="land-main">
      <div className="auth-card">
        {mode === 'up' && <SignupSteps at={step === 'verify' ? 1 : 0} />}
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="auth-title">{h1}</h1>
          <p className="auth-sub">{sub}</p>
        </div>
        {!verifying && (
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={mode !== 'up'} className={mode !== 'up' ? 'on' : ''} onClick={() => go('in')} type="button">Sign in</button>
            <button role="tab" aria-selected={mode === 'up'} className={mode === 'up' ? 'on' : ''} onClick={() => go('up')} type="button">Create account</button>
          </div>
        )}

        {verifying ? (
          <div className="stack" style={{ gap: 16 }}>
            <div className="verifyBox">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
              <div style={{ fontSize: 17, fontWeight: 600 }}>Check your email</div>
              <div className="muted" style={{ fontSize: 14, lineHeight: 1.45 }}>We sent a verification link to<br /><span style={{ color: 'var(--text)', fontWeight: 500 }}>{email.trim()}</span></div>
            </div>
            <Turnstile onToken={setToken} resetKey={reset} />
            {err && <Alert>{err}</Alert>}
            {info && <Alert kind="ok">{info}</Alert>}
            <button className="btn primary cta" disabled={busy} onClick={iVerified}>{busy ? 'Please wait…' : 'I have verified my email'}</button>
            <div className="row between">
              <button type="button" className="btn linkish" onClick={resend} disabled={busy}>Resend email</button>
              <button type="button" className="btn linkish" onClick={() => { setStep('account'); setErr(''); setInfo(''); }}>Use a different email</button>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.45 }}>The link can take a minute. Check your spam folder if it does not arrive.</p>
          </div>
        ) : done ? (
          <div className="stack">
            <Alert kind="ok">{done}</Alert>
            <button className="btn cta" onClick={() => go('in')}>Back to sign in</button>
          </div>
        ) : (
          <form className="stack" style={{ gap: 16 }} onSubmit={submit} noValidate>
            <label className="field"><span>Email</span>
              <input className="input" type="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            {mode !== 'forgot' && (
              <label className="field"><span>Password</span>
                <input className="input" type="password" placeholder={mode === 'up' ? 'At least 8 characters' : 'Your password'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
              </label>
            )}
            {mode === 'up' && (
              <label className="field"><span>Confirm password</span>
                <input className="input" type="password" placeholder="Repeat your password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
              </label>
            )}
            <Turnstile onToken={setToken} resetKey={reset} />
            {err && <Alert>{err}</Alert>}
            <button className="btn primary cta" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}
            </button>
            {mode === 'in' && (
              <>
                <button type="button" className="btn linkish" style={{ alignSelf: 'center' }} onClick={() => go('forgot')}>Forgot password?</button>
                <div className="noteBox">Reviewer or registrar? Use the invitation email from your admin to set your password first, then sign in here.</div>
              </>
            )}
            {mode === 'forgot' && (
              <>
                <button type="button" className="btn linkish" style={{ alignSelf: 'center' }} onClick={() => go('in')}>Back to sign in</button>
                <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>If the address belongs to an account, a link to choose a new password will arrive shortly.</p>
              </>
            )}
            {mode === 'up' && (
              <>
                <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>We will email a link to verify your address. After that you add your title, name, area, district and voice part once.</p>
                <div className="muted center" style={{ fontSize: 14 }}>Already have an account? <button type="button" className="btn linkish" style={{ minHeight: 0, display: 'inline', fontWeight: 600, fontSize: 14 }} onClick={() => go('in')}>Sign in</button></div>
              </>
            )}
          </form>
        )}
      </div>
      <section className="land-more">
        <h3>{mode === 'up' ? 'How it works' : 'What you can do here'}</h3>
        <LandList signup={mode === 'up'} />
      </section>
      </main>
    </div>
  );
}
