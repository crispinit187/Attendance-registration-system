import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

const paths: Record<string, string> = {
  check: 'M5 12l5 5 9-11',
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  scan: 'M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M4 12h16',
  clock: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 20a7 7 0 0114 0M17 4.5a3.5 3.5 0 010 6.5M22 20a7 7 0 00-4-6.3',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  cal: 'M4 7h16v13H4zM4 11h16M8 3v4M16 3v4',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  pin: 'M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  log: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3',
  down: 'M12 4v12m0 0l-5-5m5 5l5-5M5 20h14',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
  out: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  plus: 'M12 5v14M5 12h14',
  tv: 'M3 5h18v12H3zM8 21h8M12 17v4',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
  map: 'M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4-4',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  share: 'M12 3v12M8 7l4-4 4 4M5 13v7h14v-7',
  lock: 'M6 11h12v10H6zM8 11V8a4 4 0 018 0v3',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z',
  chat: 'M4 5h16v11H9l-5 4z',
};
export function Icon({ name, size = 20 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? paths.check} />
    </svg>
  );
}

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg className="logosvg" width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
      <rect x="2" y="2" width="40" height="40" rx="12" fill="var(--accent)" />
      <path d="M13 23l6 6 12-13" fill="none" stroke="var(--accent-ink)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export function BrandLabel({ short, size = 44 }: { short?: boolean; size?: number }) {
  return (
    <div className="brand"><Logo size={size} /><div>Attendance<br />{short ? 'Registration' : 'Registration System'}</div></div>
  );
}

export const Spinner = () => <span className="spinner" role="status" aria-label="Loading" />;
export const Loading = () => <div className="loading"><Spinner /></div>;

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'ok' | 'warn' | 'info'; children: ReactNode }) {
  return <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : undefined}>{children}</div>;
}
export const Badge = ({ kind = '', children }: { kind?: string; children: ReactNode }) => <span className={`badge ${kind}`}>{children}</span>;

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog(props: {
  title: string; body: ReactNode; confirmLabel: string; danger?: boolean;
  typeToConfirm?: string; askReason?: boolean;
  onConfirm: (reason: string) => Promise<void> | void; onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const blocked = (props.typeToConfirm !== undefined && typed.trim() !== props.typeToConfirm) || busy
    || (props.askReason === true && reason.trim().length < 3);
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <div className="stack">
        <div>{props.body}</div>
        {props.askReason && (
          <label className="field"><span>Reason (required, saved in the audit log)</span>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Not a member of this group" />
          </label>
        )}
        {props.typeToConfirm !== undefined && (
          <label className="field"><span>Type <b>{props.typeToConfirm}</b> to confirm</span>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
        )}
        {err && <Alert>{err}</Alert>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={props.onClose} disabled={busy}>Cancel</button>
          <button
            className={`btn ${props.danger ? 'danger' : 'primary'}`}
            disabled={blocked}
            onClick={async () => {
              setBusy(true); setErr('');
              try { await props.onConfirm(reason); props.onClose(); }
              catch (e) { setErr((e as Error).message); setBusy(false); }
            }}
          >{busy ? 'Working…' : props.confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}

const ToastCtx = createContext<(m: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const show = useCallback((m: string) => setMsg(m), []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 3200);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}

export function Bars({ data, total, inline }: { data: Record<string, number>; total?: number; inline?: boolean }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = total ?? Math.max(1, ...entries.map(([, v]) => v));
  if (!entries.length) return <p className="muted small">No data yet.</p>;
  if (inline) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 84, fontSize: 14 }}>{k}</span>
            <div className="hbar" style={{ flex: 1, margin: 0 }}><div className="track"><div className="fill" style={{ width: `${(v / max) * 100}%` }} /></div></div>
            <span style={{ width: 28, textAlign: 'right', fontSize: 13, color: 'var(--muted)' }}>{v}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div>
      {entries.map(([k, v]) => (
        <div className="hbar" key={k}>
          <div className="t"><span>{k}</span><span>{v}</span></div>
          <div className="track"><div className="fill" style={{ width: `${Math.max(2, (v / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
