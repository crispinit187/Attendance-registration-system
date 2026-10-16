import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { errMsg } from '../../lib/format';
import { Alert, BrandLabel } from '../../components/ui';

type OtpType = 'signup' | 'invite' | 'recovery' | 'email';

/** Landing page for links in emails. The token is only used after a button click,
 *  so email scanners that open links in advance cannot use it up. */
export function Confirm() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { refresh } = useAuth();
  const hash = sp.get('token_hash');
  const type = (sp.get('type') ?? 'signup') as OtpType;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const text = type === 'recovery'
    ? { h: 'Reset your password', b: 'Continue to choose a new password.' }
    : type === 'invite'
      ? { h: 'Accept your invitation', b: 'Continue to set up your account.' }
      : { h: 'Confirm your email', b: 'Tap the button to confirm your email address.' };

  const go = async () => {
    if (!hash) return;
    setBusy(true); setErr('');
    const { error } = await supabase.auth.verifyOtp({ token_hash: hash, type });
    if (error) {
      setBusy(false);
      setErr(/expired|invalid/i.test(error.message)
        ? 'This link has expired or was already used. Please request a new one from the sign in page.'
        : errMsg(error));
      return;
    }
    await refresh();
    nav(type === 'recovery' || type === 'invite' ? '/set-password' : '/', { replace: true });
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <BrandLabel />
        <div className="stack">
          {hash ? (
            <>
              <h1 className="auth-title" style={{ fontSize: 28 }}>{text.h}</h1>
              <p className="muted">{text.b}</p>
              {err && <Alert>{err}</Alert>}
              <button className="btn primary cta block" onClick={go} disabled={busy}>{busy ? 'Please wait…' : 'Continue'}</button>
            </>
          ) : (
            <>
              <Alert>This link is not complete. Please open the link from your email again.</Alert>
              <button className="btn block" onClick={() => nav('/login')}>Go to sign in</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
