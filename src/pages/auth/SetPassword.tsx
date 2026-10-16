import { useState } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../../lib/supabase';
import { api } from '../../lib/api';
import { homeFor, useAuth } from '../../lib/auth';
import { errMsg } from '../../lib/format';
import { Alert, BrandLabel, Field } from '../../components/ui';

export function SetPassword() {
  const { account, refresh } = useAuth();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const forced = account?.must_set_password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (pw.length < 8) return setErr('Your password must be at least 8 characters.');
    if (pw !== pw2) return setErr('The two passwords do not match.');
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      await api.clearMustSetPassword();
      await refresh();
      nav(homeFor(account?.role), { replace: true });
    } catch (e2) {
      setErr(/same|different/i.test(errMsg(e2)) ? 'Please choose a password different from the old one.' : errMsg(e2));
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <BrandLabel />
        <form className="stack" onSubmit={submit} noValidate>
          <h1 className="auth-title" style={{ fontSize: 28 }}>{forced ? 'Choose your own password' : 'Set a new password'}</h1>
          {forced && <p className="muted">You signed in with a temporary password. Choose a new one to continue.</p>}
          <Field label="New password" hint="At least 8 characters."><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Confirm new password"><input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
          {err && <Alert>{err}</Alert>}
          <button className="btn primary cta block" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        </form>
      </div>
    </div>
  );
}
