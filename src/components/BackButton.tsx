import { Link } from 'react-router';
import { Icon } from './ui';

/** A clear button back to the parent page, instead of a small text link. */
export function BackButton({ to, children }: { to: string; children: string }) {
  return <Link to={to} className="btn small backbtn" style={{ alignSelf: 'flex-start', width: 'fit-content' }}><Icon name="back" size={16} />{children}</Link>;
}
