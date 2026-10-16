import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { BrandLabel, Icon } from './ui';
import { SignOutButton } from './SignOut';

interface Item { to: string; label: string; icon: string; end?: boolean }
const MEMBER: Item[] = [
  { to: '/app', label: 'Home', icon: 'home', end: true },
  { to: '/app/history', label: 'History', icon: 'clock' },
  { to: '/app/profile', label: 'Profile', icon: 'user' },
];
const ADMIN: Item[] = [
  { to: '/admin', label: 'Dashboard', icon: 'home', end: true },
  { to: '/admin/lists', label: 'Events and lists', icon: 'cal' },
  { to: '/signups', label: 'Sign-ups', icon: 'link' },
  { to: '/admin/people', label: 'People', icon: 'users' },
  { to: '/admin/accounts', label: 'Accounts', icon: 'shield' },
  { to: '/admin/setup', label: 'Areas, titles and voice parts', icon: 'tag' },
  { to: '/admin/districts', label: 'Districts', icon: 'pin' },
  { to: '/admin/audit', label: 'Audit log', icon: 'log' },
  { to: '/admin/exports', label: 'Exports', icon: 'down' },
];
const REVIEWER = [
  { id: 'rv-top', label: 'Overview', icon: 'home' },
  { id: 'rv-access', label: 'Lists', icon: 'list' },
  { id: 'rv-attendance', label: 'Attendance', icon: 'users' },
  { id: 'rv-charts', label: 'Analytics', icon: 'chart' },
  { id: 'rv-export', label: 'Exports', icon: 'down' },
];
const REGISTRAR = [
  { id: 'rg-mark', label: 'Mark', icon: 'search' },
  { id: 'rg-present', label: 'Present', icon: 'list' },
  { id: 'rg-add', label: 'Add', icon: 'plus' },
];

export function HeaderActions() {
  const { theme, toggle } = useTheme();
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      <button className="iconbtn" onClick={toggle} aria-label="Switch between light and dark" title="Light / dark"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
      <SignOutButton className="iconbtn" label="Sign out" title="Sign out"><Icon name="out" /></SignOutButton>
    </div>
  );
}

const jump = (id: string) => {
  if (id.endsWith('-top')) window.scrollTo({ top: 0, behavior: 'smooth' });
  else document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

export function Shell() {
  const { account } = useAuth();
  const role = account?.role ?? 'member';
  const [active, setActive] = useState('');
  const loc = useLocation();
  const nav = useNavigate();
  const onRegistrar = loc.pathname === '/registrar';
  const name = account?.full_name || account?.email || '';

  // Member and registrar: header lives inside each page, tabs at the bottom.
  if (role === 'member') {
    return (
      <div className="shell">
        <Outlet />
        <nav className="bottomnav" aria-label="Main">
          {MEMBER.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')}><Icon name={i.icon} size={22} />{i.label}</NavLink>
          ))}
        </nav>
      </div>
    );
  }
  if (role === 'registrar') {
    return (
      <div className="shell">
        <Outlet />
        <nav className="bottomnav" aria-label="Main">
          {REGISTRAR.map((i) => (
            <button key={i.id} className={onRegistrar && (active === i.id || (!active && i.id === 'rg-mark')) ? 'active' : ''}
              onClick={() => { setActive(i.id); if (onRegistrar) jump(i.id); else { nav('/registrar'); setTimeout(() => jump(i.id), 250); } }}><Icon name={i.icon} size={22} />{i.label}</button>
          ))}
          <NavLink to="/signups" className={({ isActive }) => (isActive ? 'active' : '')}><Icon name="link" size={22} />Sign-ups</NavLink>
        </nav>
      </div>
    );
  }

  // Admin and reviewer: sidebar on desktop, top bar on phones.
  const isAdmin = role === 'admin';
  return (
    <div className="shell admin">
      <nav className="sidenav" aria-label="Sections">
        <div className="brand" style={{ padding: '0 8px 18px', margin: 0, fontSize: 12 }}><svg width="36" height="36" viewBox="0 0 44 44" aria-hidden="true"><rect x="2" y="2" width="40" height="40" rx="12" fill="var(--accent)" /><path d="M13 23l6 6 12-13" fill="none" stroke="var(--accent-ink)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /></svg><div>Attendance<br />Registration</div></div>
        {isAdmin
          ? ADMIN.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')}>{i.label}</NavLink>)
          : REVIEWER.map((i) => <a key={i.id} href="#" className={(active || 'rv-top') === i.id ? 'active' : ''} onClick={(e) => { e.preventDefault(); setActive(i.id); jump(i.id); }}>{i.label}</a>)}
        <div className="signed">Signed in as<br /><b>{name}</b>
          <div style={{ marginTop: 10 }}><HeaderActions /></div></div>
      </nav>
      <div className="main" style={{ flex: 1, minWidth: 0 }}>
        <header className="topbar mobile-only">
          <BrandLabel size={32} short />
          <div className="grow" />
          <HeaderActions />
        </header>
        <Outlet />
      </div>
      {isAdmin && (
        <nav className="bottomnav" aria-label="Sections" style={{ overflowX: 'auto', justifyContent: 'flex-start' }}>
          {ADMIN.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')} style={{ minWidth: 84, fontSize: 11, textAlign: 'center' }}><Icon name={i.icon} size={20} />{i.label.split(' ')[0]}</NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
