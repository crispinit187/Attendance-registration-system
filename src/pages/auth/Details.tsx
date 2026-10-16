import { useNavigate } from 'react-router';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { BrandLabel } from '../../components/ui';
import { PersonForm, emptyProfile } from '../../components/PersonForm';
import { SignupSteps } from './Login';

/** First-time details for a new member. Shown once, right after the first sign in. */
export function Details() {
  const { account, refresh } = useAuth();
  const nav = useNavigate();
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <BrandLabel size={40} />
        <SignupSteps at={2} />
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="auth-title" style={{ fontSize: 30 }}>Tell us about you</h1>
          <p className="auth-sub">You only do this once. We use it every time you mark attendance.</p>
        </div>
        <PersonForm
          initial={{ ...emptyProfile, full_name: account?.full_name ?? '' }}
          submitLabel="Finish and go to my dashboard"
          extra={<p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.45 }}>You can edit these details later. Changes never alter your past attendance records.</p>}
          onSubmit={async (v) => { await api.saveMyProfile(v); await refresh(); nav('/app', { replace: true }); }}
        />
      </div>
    </div>
  );
}
