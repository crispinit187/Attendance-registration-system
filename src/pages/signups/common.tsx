import { BackButton } from '../../components/BackButton';
import { Link } from 'react-router';
import { useAuth } from '../../lib/auth';
import { HeaderActions } from '../../components/Shell';

/** Registrars have no sidebar, so the sign-up pages give them a way back and a sign-out button. */
export function StaffTop() {
  const { account } = useAuth();
  if (account?.role !== 'registrar') return null;
  return (
    <div className="pageHead">
      <div><div className="muted" style={{ fontSize: 13 }}>Registrar</div><BackButton to="/registrar">Back to attendance</BackButton></div>
      <HeaderActions />
    </div>
  );
}

/** Admins only (turning entries into people, deleting entries for good). */
export const useIsAdmin = () => useAuth().account?.role === 'admin';
/** Admins and event managers: settings, open and close, contact numbers, restore and export. */
export const useCanManage = () => ['admin', 'manager', 'list_manager'].includes(useAuth().account?.role ?? '');
/** Admins and event managers only: create, edit and delete lists, make new links, see who has access. */
export const useCanEdit = () => ['admin', 'manager'].includes(useAuth().account?.role ?? '');
