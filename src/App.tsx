import type { ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { homeFor, needsDetails, useAuth } from './lib/auth';
import { configured } from './lib/supabase';
import type { Role } from './lib/types';
import { Alert, Loading } from './components/ui';
import { Shell } from './components/Shell';
import { SignOutButton } from './components/SignOut';
import { BrandFooter } from './components/BrandFooter';
import { Login } from './pages/auth/Login';
import { Confirm } from './pages/auth/Confirm';
import { SetPassword } from './pages/auth/SetPassword';
import { Details } from './pages/auth/Details';
import { Dashboard } from './pages/member/Dashboard';
import { Scan, ScanLanding } from './pages/member/Scan';
import { History } from './pages/member/History';
import { Profile } from './pages/member/Profile';
import { Registrar } from './pages/registrar/Registrar';
import { VenueScreen } from './pages/venue/VenueScreen';
import { Reviewer } from './pages/reviewer/Reviewer';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { Lists } from './pages/admin/Lists';
import { ListDetail } from './pages/admin/ListDetail';
import { People } from './pages/admin/People';
import { Accounts } from './pages/admin/Accounts';
import { Setup } from './pages/admin/Setup';
import { Districts } from './pages/admin/Districts';
import { AuditLog } from './pages/admin/AuditLog';
import { Exports } from './pages/admin/Exports';
import { Join } from './pages/join/Join';
import { SignupLists } from './pages/signups/SignupLists';
import { SignupDetail } from './pages/signups/SignupDetail';

function Guard({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { loading, session, account, person } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!session) {
    try { sessionStorage.setItem('afterLogin', loc.pathname + loc.search); } catch { /* ignore */ }
    return <Navigate to="/login" replace />;
  }
  if (!account) {
    return (
      <div className="auth-wrap"><div className="auth-card stack">
        <Loading />
        <p className="muted center small">Setting up your account… If this takes more than a few seconds, sign out and try again.</p>
        <SignOutButton className="btn block">Sign out</SignOutButton>
      </div></div>
    );
  }
  if (account.disabled) {
    return (
      <div className="auth-wrap"><div className="auth-card stack">
        <Alert>This account has been disabled. Please contact an admin.</Alert>
        <SignOutButton className="btn block">Sign out</SignOutButton>
      </div></div>
    );
  }
  if (account.must_set_password && loc.pathname !== '/set-password') return <Navigate to="/set-password" replace />;
  if (!account.must_set_password && needsDetails(account, person) && loc.pathname !== '/details' && loc.pathname !== '/set-password') return <Navigate to="/details" replace />;
  if (roles && !roles.includes(account.role)) return <Navigate to={homeFor(account.role)} replace />;
  return <>{children}</>;
}

function Home() {
  const { account } = useAuth();
  return <Navigate to={homeFor(account?.role)} replace />;
}

function LoginRoute() {
  const { loading, session, account } = useAuth();
  if (loading) return <Loading />;
  if (session && account) {
    let to = homeFor(account.role);
    try { const a = sessionStorage.getItem('afterLogin'); if (a && a !== '/login') { to = a; sessionStorage.removeItem('afterLogin'); } } catch { /* ignore */ }
    return <Navigate to={to} replace />;
  }
  return <Login />;
}

function SetupNeeded() {
  return (
    <div className="auth-wrap"><div className="auth-card stack">
      <h1>Almost there</h1>
      <Alert kind="warn">This site is not connected to its database yet. The site owner needs to add the Supabase address and public key in the build settings (see README, step 7).</Alert>
    </div></div>
  );
}

export default function App() {
  if (!configured) return <><SetupNeeded /><BrandFooter /></>;
  return (
    <>
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/auth/confirm" element={<Confirm />} />
        <Route path="/join/:code" element={<Join />} />
        <Route path="/set-password" element={<Guard><SetPassword /></Guard>} />
        <Route path="/details" element={<Guard roles={['member']}><Details /></Guard>} />
        <Route path="/venue/:listId" element={<Guard roles={['admin', 'registrar']}><VenueScreen /></Guard>} />

        <Route element={<Guard roles={['member']}><Shell /></Guard>}>
          <Route path="/app" element={<Dashboard />} />
          <Route path="/app/scan" element={<Scan />} />
          <Route path="/app/history" element={<History />} />
          <Route path="/app/profile" element={<Profile />} />
          <Route path="/scan/:listId" element={<ScanLanding />} />
        </Route>
        <Route element={<Guard roles={['registrar']}><Shell /></Guard>}>
          <Route path="/registrar" element={<Registrar />} />
        </Route>
        <Route element={<Guard roles={['admin', 'registrar']}><Shell /></Guard>}>
          <Route path="/signups" element={<SignupLists />} />
          <Route path="/signups/:id" element={<SignupDetail />} />
        </Route>
        <Route element={<Guard roles={['reviewer']}><Shell /></Guard>}>
          <Route path="/review" element={<Reviewer />} />
        </Route>
        <Route element={<Guard roles={['admin']}><Shell /></Guard>}>
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/lists" element={<Lists />} />
          <Route path="/admin/lists/:id" element={<ListDetail />} />
          <Route path="/admin/people" element={<People />} />
          <Route path="/admin/accounts" element={<Accounts />} />
          <Route path="/admin/setup" element={<Setup />} />
          <Route path="/admin/districts" element={<Districts />} />
          <Route path="/admin/exports" element={<Exports />} />
          <Route path="/admin/audit" element={<AuditLog />} />
        </Route>
        <Route path="*" element={<Guard><Home /></Guard>} />
      </Routes>
    </HashRouter>
    <BrandFooter />
    </>
  );
}
