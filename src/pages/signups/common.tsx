import { Link } from 'react-router';
import { useAuth } from '../../lib/auth';
import { HeaderActions } from '../../components/Shell';

/** Registrars have no sidebar, so the sign-up pages give them a way back and a sign-out button. */
export function StaffTop() {
  const { account } = useAuth();
  if (account?.role !== 'registrar') return null;
  return (
    <div className="pageHead">
      <div><div className="muted" style={{ fontSize: 13 }}>Registrar</div><Link to="/registrar" style={{ fontSize: 14 }}>← Back to attendance</Link></div>
      <HeaderActions />
    </div>
  );
}

export const useIsAdmin = () => useAuth().account?.role === 'admin';
