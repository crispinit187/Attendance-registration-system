import { useLiveSync } from '../lib/live';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { BrandLabel, Icon } from './ui';
import { SignOutButton } from './SignOut';
import { OfflineBar } from './OfflineBar';
import { RecentActionsButton } from './RecentActions';
import { SearchButton, SearchHost } from './GlobalSearch';
import { useAutoFlush } from '../lib/offline';

interface Item { to: string; label: string; icon: string; end?: boolean }
const MEMBER: Item[] = [
  { to: '/app', label: 'Home', icon: 'home', end: true },
  { to: '/app/history', label: 'History', icon: 'clock' },
  { to: '/app/profile', label: 'Profile', icon: 'user' },
];
const ADMIN: Item[] = [
  { to: '/admin', label: 'Dashboard', icon: 'home', end: true },
  { to: '/admin/lists', label: 'Events', icon: 'cal' },
  { to: '/trackers', label: 'Trackers', icon: 'list' },
  { to: '/signups', label: 'Sign-ups', icon: 'link' },
  { to: '/admin/people', label: 'People', icon: 'users' },
  { to: '/admin/accounts', label: 'Accounts', icon: 'shield' },
  { to: '/admin/setup', label: 'Areas, titles and voice parts', icon: 'tag' },
  { to: '/admin/districts', label: 'Districts', icon: 'pin' },
  { to: '/admin/congregations', label: 'Congregations', icon: 'pin' },
  { to: '/admin/audit', label: 'Audit log', icon: 'log' },
  { to: '/admin/exports', label: 'Exports', icon: 'down' },
];
const MANAGER: Item[] = [
  { to: '/manage/lists', label: 'Events', icon: 'cal' },
  { to: '/trackers', label: 'Trackers', icon: 'list' },
  { to: '/signups', label: 'Sign-ups', icon: 'link' },
  { to: '/manage/exports', label: 'Exports', icon: 'down' },
];
const LISTMGR: Item[] = [{ to: '/trackers', label: 'Trackers', icon: 'list' }];
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
  const { account } = useAuth();
  const role = account?.role ?? 'member';
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      {role !== 'member' && <SearchButton />}
      {['admin', 'manager', 'list_manager', 'registrar'].includes(role) && <RecentActionsButton />}
      <button className="iconbtn" onClick={toggle} aria-label="Switch between light and dark" title="Light / dark"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
      <SignOutButton className="iconbtn" label="Sign out" title="Sign out"><Icon name="out" /></SignOutButton>
    </div>
  );
}

const pagesFor = (role: string): { to: string; label: string }[] =>
  role === 'admin' ? ADMIN : role === 'manager' ? MANAGER : role === 'list_manager' ? LISTMGR
    : role === 'registrar' ? [{ to: '/registrar', label: 'Mark attendance' }, { to: '/trackers', label: 'Trackers' }, { to: '/signups', label: 'Sign-ups' }]
      : role === 'reviewer' ? [{ to: '/review', label: 'Attendance' }, { to: '/trackers', label: 'Trackers' }] : [];

const jump = (id: string) => {
  if (id.endsWith('-top')) window.scrollTo({ top: 0, behavior: 'smooth' });
  else document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/** The page area. A new page slides in a few pixels (from the right when going deeper, from the left when going back). */
function AnimatedOutlet() {
  const loc = useLocation();
  const depth = loc.pathname.split('/').filter(Boolean).length;
  const prev = useRef({ path: loc.pathname, depth, dir: 'fade' });
  if (prev.current.path !== loc.pathname) {
    prev.current = { path: loc.pathname, depth, dir: depth > prev.current.depth ? 'fwd' : depth < prev.current.depth ? 'back' : 'fade' };
  }
  return <div key={loc.pathname} className={`pageanim ${prev.current.dir}`}><Outlet /></div>;
}

/** Moves the highlight behind the active side-panel link, so changing section slides instead of jumping. */
function useNavPill(ref: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  useLayoutEffect(() => {
    const place = () => {
      const nav = ref.current; if (!nav) return;
      const a = nav.querySelector<HTMLElement>('a.active');
      const pill = nav.querySelector<HTMLElement>('.navpill'); if (!pill) return;
      if (!a) { pill.style.opacity = '0'; return; }
      pill.style.opacity = '1'; pill.style.height = `${a.offsetHeight}px`; pill.style.transform = `translateY(${a.offsetTop}px)`;
    };
    place();
    window.addEventListener('resize', place);
    void document.fonts?.ready.then(place);
    return () => window.removeEventListener('resize', place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Top bar for the admin-style layout: search, recent actions, light/dark and sign out live here. */
function TopBar() {
  const [raised, setRaised] = useState(false);
  useEffect(() => {
    const on = () => setRaised(window.scrollY > 4);
    on(); window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`topbar ${raised ? 'raised' : ''}`}>
      <span className="mobile-only"><BrandLabel size={32} short /></span>
      <div className="grow" />
      <HeaderActions />
    </header>
  );
}

export function Shell() {
  const { account, session } = useAuth();
  const qc = useQueryClient();
  useLiveSync();
  useAutoFlush(session?.user.id ?? '', useCallback(() => { void qc.invalidateQueries(); }, [qc]));
  const role = account?.role ?? 'member';
  const [active, setActive] = useState('');
  const loc = useLocation();
  const nav = useNavigate();
  const onRegistrar = loc.pathname === '/registrar';
  const sideRef = useRef<HTMLElement>(null);
  useNavPill(sideRef, [loc.pathname, active, role]);
  const name = account?.full_name || account?.email || '';
  const done = useCallback(() => { void qc.invalidateQueries(); }, [qc]);

  // Member and registrar: header lives inside each page, tabs at the bottom.
  if (role === 'member') {
    return (
      <div className="shell">
        <AnimatedOutlet />
        <OfflineBar onDone={done} />{role !== 'member' && <SearchHost pages={pagesFor(role)} />}
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
        <AnimatedOutlet />
        <OfflineBar onDone={done} /><SearchHost pages={pagesFor(role)} />
        <nav className="bottomnav" aria-label="Main">
          {REGISTRAR.map((i) => (
            <button key={i.id} className={onRegistrar && (active === i.id || (!active && i.id === 'rg-mark')) ? 'active' : ''}
              onClick={() => { setActive(i.id); if (onRegistrar) jump(i.id); else { nav('/registrar'); setTimeout(() => jump(i.id), 250); } }}><Icon name={i.icon} size={22} />{i.label}</button>
          ))}
          <NavLink to="/trackers" className={({ isActive }) => (isActive ? 'active' : '')}><Icon name="list" size={22} />Trackers</NavLink>
          <NavLink to="/signups" className={({ isActive }) => (isActive ? 'active' : '')}><Icon name="link" size={22} />Sign-ups</NavLink>
        </nav>
      </div>
    );
  }

  // Admin, event manager and reviewer: sidebar on desktop, top bar on phones.
  const isAdmin = role === 'admin';
  const onTrackers = loc.pathname.startsWith('/trackers');
  const items = isAdmin ? ADMIN : role === 'manager' ? MANAGER : role === 'list_manager' ? LISTMGR : role === 'reviewer' && onTrackers ? [{ to: '/review', label: 'Attendance', icon: 'chart' }, { to: '/trackers', label: 'Trackers', icon: 'list' }] : null;
  return (
    <div className="shell admin">
      <nav className="sidenav" aria-label="Sections" ref={sideRef}>
        <span className="navpill" aria-hidden="true" />
        <div className="brand" style={{ padding: '0 8px 18px', margin: 0, fontSize: 12 }}><svg width="36" height="36" viewBox="0 0 44 44" aria-hidden="true"><rect x="2" y="2" width="40" height="40" rx="12" fill="var(--accent)" /><path d="M13 23l6 6 12-13" fill="none" stroke="var(--accent-ink)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /></svg><div>Attendance<br />Registration</div></div>
        {items
          ? items.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')}>{i.label}</NavLink>)
          : <>{REVIEWER.map((i) => <a key={i.id} href="#" className={(active || 'rv-top') === i.id ? 'active' : ''} onClick={(e) => { e.preventDefault(); setActive(i.id); jump(i.id); }}>{i.label}</a>)}<NavLink to="/trackers" className={({ isActive }) => (isActive ? 'active' : '')}>Trackers</NavLink></>}
        <div className="signed">Signed in as<br /><b>{name}</b></div>
      </nav>
      <div className="main" style={{ flex: 1, minWidth: 0 }}>
        <TopBar />
        <AnimatedOutlet />
      </div>
      <OfflineBar onDone={done} /><SearchHost pages={pagesFor(role)} />
      {items && (
        <nav className="bottomnav" aria-label="Sections" style={{ overflowX: 'auto', justifyContent: 'flex-start' }}>
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')} style={{ minWidth: 84, fontSize: 11, textAlign: 'center' }}><Icon name={i.icon} size={20} />{i.label.split(' ')[0]}</NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
