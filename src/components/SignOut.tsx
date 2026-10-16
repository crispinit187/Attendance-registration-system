import { useState, type ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { ConfirmDialog } from './ui';

/**
 * A sign-out button that asks first, so nobody is logged out by an accidental tap.
 * The same confirmation is used in the top bar and on the "setting up" / "disabled" screens.
 */
export function SignOutButton({ className, title, label, children }: {
  className?: string; title?: string; label?: string; children: ReactNode;
}) {
  const { signOut } = useAuth();
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button type="button" className={className} title={title} aria-label={label} onClick={() => setAsking(true)}>{children}</button>
      {asking && (
        <ConfirmDialog
          title="Sign out?" confirmLabel="Sign out"
          body={<p>You will need to sign in again to continue.</p>}
          onClose={() => setAsking(false)}
          onConfirm={async () => { await signOut(); }} />
      )}
    </>
  );
}
