import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { errMsg } from '../../lib/format';
import { Alert, Icon, Spinner, useToast } from '../../components/ui';

function getPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('This device cannot share its location, which this list needs.'));
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => rej(new Error(e.code === 1
        ? 'Location is needed for this list. Allow location access for this site in your browser settings, then scan again.'
        : 'Could not get your location. Move to an open spot and try again.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

/** Parses the text inside a QR code: https://…/#/scan/<listId>?k=<token> */
export function parseScan(text: string): { listId: string; token: string } | null {
  const m = text.match(/#\/scan\/([0-9a-f-]{36})\?k=([\w-]+)/i);
  return m ? { listId: m[1]!, token: m[2]! } : null;
}

/** Marks the signed-in member present, then shows the result. */
export function MarkFlow({ listId, token }: { listId: string; token: string }) {
  const [state, setState] = useState<'work' | 'ok' | 'already' | 'err'>('work');
  const [msg, setMsg] = useState('');
  const [title, setTitle] = useState('');
  const [attId, setAttId] = useState('');
  const [markedAt, setMarkedAt] = useState(0);
  const [undone, setUndone] = useState(false);
  const started = useRef(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const open = (await api.openLists()).find((l) => l.id === listId);
        if (!open) throw new Error('Registration is closed, or this QR code is for a different list.');
        const pos = open.location_check ? await getPosition() : undefined;
        const r = await api.markMine(listId, token, pos);
        setTitle(r.list_title);
        setAttId(r.attendance_id);
        setMarkedAt(Date.now());
        setState(r.status === 'already' ? 'already' : 'ok');
        void qc.invalidateQueries({ queryKey: ['open-lists'] });
        void qc.invalidateQueries({ queryKey: ['my-history'] });
      } catch (e) { setMsg(errMsg(e)); setState('err'); }
    })();
  }, [listId, token, qc]);

  const canUndo = state === 'ok' && !undone && attId && Date.now() - markedAt < 110_000;
  return (
    <div className="card hero stack" style={{ alignItems: 'center' }}>
      {state === 'work' && (<><Spinner /><p className="muted">Marking your attendance…</p></>)}
      {state === 'ok' && (
        <>
          <div className="logo" style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--ok)' }}><Icon name="check" size={38} /></div>
          <h2>{undone ? 'Attendance removed' : "You're marked present"}</h2>
          <p className="muted">{title}</p>
        </>
      )}
      {state === 'already' && (<><h2>Already marked</h2><p className="muted">You were already marked present for {title}.</p></>)}
      {state === 'err' && (<><Alert>{msg}</Alert></>)}
      <div className="row" style={{ justifyContent: 'center' }}>
        {canUndo && (
          <button className="btn danger" onClick={async () => {
            try { await api.undo(attId); setUndone(true); toast('Attendance removed.'); void qc.invalidateQueries({ queryKey: ['open-lists'] }); }
            catch (e) { toast(errMsg(e)); }
          }}>That was a mistake: undo</button>
        )}
        <button className="btn primary" onClick={() => nav('/app', { replace: true })}>Done</button>
      </div>
    </div>
  );
}
