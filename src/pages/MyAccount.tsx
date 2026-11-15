import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { BackButton } from '../components/BackButton';
import { homeFor } from '../lib/auth';
import { Alert, Field, useToast } from '../components/ui';
import { PasswordInput } from '../components/PasswordInput';

const msg = (e: unknown) => (e as { message?: string })?.message ?? 'Something went wrong. Try again.';
const ROLE: Record<string, string> = { admin: 'Administrator', manager: 'Event manager', list_manager: 'List manager', registrar: 'Registrar', reviewer: 'Reviewer', member: 'Member' };

/** Account settings for staff and admins: name, phone, password, and email (the new address is verified first). */
export function MyAccount() {
  const { account, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(account?.full_name ?? '');
  const [phone, setPhone] = useState(account?.phone ?? '');
  const [pErr, setPErr] = useState(''); const [pBusy, setPBusy] = useState(false);
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [wErr, setWErr] = useState(''); const [wBusy, setWBusy] = useState(false);
  const [mail, setMail] = useState(''); const [mErr, setMErr] = useState(''); const [mBusy, setMBusy] = useState(false); const [sentTo, setSentTo] = useState('');

  const saveProfile = async () => {
    setPErr(''); setPBusy(true);
    const { error } = await supabase.rpc('update_my_account', { p_name: name, p_phone: phone });
    setPBusy(false);
    if (error) return setPErr(msg(error));
    await refresh(); toast('Details saved.');
  };
  const savePassword = async () => {
    setWErr('');
    if (pw.length < 8) return setWErr('Use at least 8 characters.');
    if (pw !== pw2) return setWErr('The two passwords do not match.');
    if (!cur) return setWErr('Enter your current password.');
    setWBusy(true);
    // Confirm the current password first, so a borrowed open session cannot change it.
    const chk = await supabase.auth.signInWithPassword({ email: account?.email ?? '', password: cur });
    if (chk.error) { setWBusy(false); return setWErr('The current password is not right.'); }
    const { error } = await supabase.auth.updateUser({ password: pw });
    setWBusy(false);
    if (error) return setWErr(msg(error));
    setCur(''); setPw(''); setPw2(''); toast('Password changed.');
  };
  const saveEmail = async () => {
    setMErr('');
    const em = mail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return setMErr('Enter a valid email address.');
    if (em === (account?.email ?? '').toLowerCase()) return setMErr('That is already your email.');
    setMBusy(true);
    const { error } = await supabase.auth.updateUser({ email: em }, { emailRedirectTo: `${window.location.origin}${window.location.pathname}#/auth/confirm` });
    setMBusy(false);
    if (error) return setMErr(msg(error));
    setSentTo(em); setMail('');
  };

  return (
    <div className="page stack" style={{ paddingTop: 32 }}>
      <BackButton to={homeFor(account?.role)}>Back</BackButton>
      <div className="pageHead"><h1>My account</h1></div>
      <p className="muted small" style={{ margin: 0 }}>{ROLE[account?.role ?? ''] ?? account?.role} · signed in as {account?.email}</p>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Your details</h2>
        <Field label="Full name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
        <Field label="Phone (optional)"><input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" /></Field>
        {pErr && <Alert>{pErr}</Alert>}
        <button className="btn primary" disabled={pBusy} onClick={() => void saveProfile()}>{pBusy ? 'Saving…' : 'Save details'}</button>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Change password</h2>
        <Field label="Current password"><PasswordInput value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
        <Field label="New password" hint="At least 8 characters."><PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="New password again"><PasswordInput value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
        {wErr && <Alert>{wErr}</Alert>}
        <button className="btn primary" disabled={wBusy} onClick={() => void savePassword()}>{wBusy ? 'Changing…' : 'Change password'}</button>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Change email</h2>
        <p className="muted small" style={{ margin: 0 }}>We send a confirmation link to the new address. Your email stays as it is, and you keep signing in with it, until the link is opened.</p>
        {sentTo && <Alert kind="ok">Confirmation sent to {sentTo}. Open the link in that email to finish the change. If your project asks for both addresses to confirm, a link is also sent to {account?.email}.</Alert>}
        <Field label="New email address"><input className="input" type="email" value={mail} onChange={(e) => setMail(e.target.value)} autoComplete="email" /></Field>
        {mErr && <Alert>{mErr}</Alert>}
        <button className="btn primary" disabled={mBusy || !mail} onClick={() => void saveEmail()}>{mBusy ? 'Sending…' : 'Send confirmation'}</button>
      </div>
    </div>
  );
}
