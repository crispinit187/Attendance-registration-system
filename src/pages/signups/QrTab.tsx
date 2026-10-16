import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { QRCodeCanvas } from 'qrcode.react';
import { api } from '../../lib/api';
import { joinUrl } from '../../lib/qrurl';
import { download, safeName } from '../../lib/format';
import type { SignupDetailInfo } from '../../lib/types';
import { Alert, ConfirmDialog, Icon, Modal, useToast } from '../../components/ui';
import { useLookups } from '../../lib/auth';
import { SignupForm } from './SignupForm';

/** The QR code and the shareable link (the same address), plus the admin-only settings. */
export function QrTab({ list, isAdmin }: { list: SignupDetailInfo; isAdmin: boolean }) {
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { areas, voices } = useLookups();
  const ref = useRef<HTMLDivElement>(null);
  const [big, setBig] = useState(false);
  const [editing, setEditing] = useState(false);
  const [act, setAct] = useState<'link' | 'delete' | null>(null);
  const url = joinUrl(list.code);
  const reload = () => { void qc.invalidateQueries({ queryKey: ['signup', list.id] }); void qc.invalidateQueries({ queryKey: ['signup-lists'] }); };

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast('Link copied.'); }
    catch { toast('Could not copy. Select the link and copy it by hand.'); }
  };
  const share = async () => {
    const text = `${list.title}: sign up here`;
    if (navigator.share) { try { await navigator.share({ title: list.title, text, url }); } catch { /* cancelled */ } return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, '_blank', 'noopener');
  };
  const save = () => {
    const c = ref.current?.querySelector('canvas');
    c?.toBlob((b) => { if (b) download(b, `${safeName(list.title)}-signup-QR.png`); });
  };
  const voiceNames = list.voice_part_ids.length ? voices.filter((v) => list.voice_part_ids.includes(v.id)).map((v) => v.name).join(', ') : 'All voice parts';
  const areaNames = list.allowed_area_ids.length ? areas.filter((a) => list.allowed_area_ids.includes(a.id)).map((a) => a.name).join(', ') : 'Every area';

  return (
    <div className="stack">
      <div className="card flat stack">
        <h3 style={{ margin: 0 }}>QR code and link</h3>
        {list.status !== 'open' && <Alert kind="warn">Sign-ups are closed. Anyone who scans or opens the link sees a “closed” message until an admin opens sign-ups.</Alert>}
        <div ref={ref} className="qrbox" style={{ alignSelf: 'flex-start' }}><QRCodeCanvas value={url} size={220} marginSize={2} level="M" /></div>
        <div className="row">
          <button className="btn" onClick={save}><Icon name="down" size={16} />Download QR (PNG)</button>
          <button className="btn ghost" onClick={() => setBig(true)}><Icon name="tv" size={16} />Show on screen</button>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">Link, for when the projector or power is down</b>
          <div className="linkbox">
            <input className="input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Sign-up link" />
            <button className="btn" onClick={() => void copy()}><Icon name="copy" size={16} />Copy</button>
            <button className="btn" onClick={() => void share()}><Icon name="share" size={16} />Share</button>
          </div>
          <span className="hint">The link does exactly what the QR code does, with the same protections: the open/closed switch, the human check, limits on repeat sign-ups and the duplicate checks{list.location_check ? `, and the location check (${list.radius_m} m)` : ''}.</span>
        </div>
      </div>

      {isAdmin && (
        <div className="card flat stack">
          <h3 style={{ margin: 0 }}>Settings</h3>
          <div className="muted small" style={{ lineHeight: 1.7 }}>
            Voice parts offered: <b style={{ color: 'var(--text)' }}>{voiceNames}</b><br />
            Who can sign up: <b style={{ color: 'var(--text)' }}>{areaNames}</b><br />
            Location check: <b style={{ color: 'var(--text)' }}>{list.location_check ? `Within ${list.radius_m} m of the venue` : 'Off'}</b>
          </div>
          <div className="row">
            <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={16} />Edit settings</button>
            <button className="btn" onClick={() => setAct('link')}><Icon name="link" size={16} />Make a new link</button>
            <button className="btn danger" onClick={() => setAct('delete')}>Delete this list…</button>
          </div>
          <span className="hint">“Make a new link” replaces the code: the old link, and every printed or shared QR code, stop working at once. Use it if the link reaches people who should not have it.</span>
        </div>
      )}

      {big && (
        <Modal title={list.title} onClose={() => setBig(false)}>
          <div className="stack" style={{ alignItems: 'center' }}>
            <div className="qrbox"><QRCodeCanvas value={url} size={Math.min(340, window.innerWidth - 110)} marginSize={2} level="M" /></div>
            <div className="muted center small">Scan to sign up. No account needed.</div>
          </div>
        </Modal>
      )}
      {editing && <SignupForm list={list} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); toast('Saved.'); }} />}
      {act === 'link' && (
        <ConfirmDialog title="Make a new link?" danger confirmLabel="Make a new link"
          body={<p>The current link and every printed or shared QR code for this list will stop working straight away. You will need to show or share the new ones. This is written to the audit log.</p>}
          onClose={() => setAct(null)} onConfirm={async () => { await api.signupNewLink(list.id); toast('New link made.'); reload(); }} />
      )}
      {act === 'delete' && (
        <ConfirmDialog title="Delete this sign-up list for good?" danger confirmLabel="Delete forever" typeToConfirm={list.title}
          body={list.status === 'open'
            ? <Alert kind="warn">Close sign-ups first. An open list cannot be deleted.</Alert>
            : <p><b>This cannot be undone.</b> The list and all {list.entries} entries in it will be permanently deleted. The deletion is written to the audit log.</p>}
          onClose={() => setAct(null)}
          onConfirm={async () => { await api.signupDelete(list.id, list.title); toast('Sign-up list deleted.'); void qc.invalidateQueries({ queryKey: ['signup-lists'] }); nav('/signups'); }} />
      )}
    </div>
  );
}
