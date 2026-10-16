import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../../lib/api';
import { scanUrl } from '../../lib/qrurl';
import { errMsg } from '../../lib/format';
import type { QrPayload } from '../../lib/types';
import { Alert, Spinner } from '../../components/ui';

/** Full-screen QR for a projector or tablet. Refreshes itself when the code rotates. */
export function VenueScreen() {
  const { listId } = useParams();
  const [qr, setQr] = useState<QrPayload | null>(null);
  const [left, setLeft] = useState(0);
  const [err, setErr] = useState('');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!listId) return;
    let dead = false;
    const load = async () => {
      try {
        const p = await api.qr(listId);
        if (dead) return;
        setQr(p); setErr('');
        if (p.mode === 'rotating') {
          setLeft(p.seconds_left ?? p.rotation_seconds ?? 30);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(load, Math.max(1, (p.seconds_left ?? 1)) * 1000 - 150);
        }
      } catch (e) {
        if (dead) return;
        setErr(errMsg(e));
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(load, 5000);
      }
    };
    void load();
    return () => { dead = true; window.clearTimeout(timer.current); };
  }, [listId]);

  useEffect(() => {
    const t = window.setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="venue">
      {err && <Alert>{err}</Alert>}
      {!qr && !err && <Spinner />}
      {qr && (
        <>
          <h1 style={{ margin: 0 }}>{qr.title}</h1>
          <p className="muted" style={{ margin: 0, fontSize: '1.1rem' }}>Scan with your phone to mark your attendance</p>
          <div className="qrbox"><QRCodeSVG value={scanUrl(qr.list_id, qr.token)} size={Math.min(440, Math.floor(window.innerWidth * 0.78))} level="M" /></div>
          {qr.mode === 'rotating' && (
            <>
              <div className="ring"><div style={{ width: `${(left / (qr.rotation_seconds ?? 30)) * 100}%` }} /></div>
              <p className="muted small" style={{ margin: 0 }}>This code changes every {qr.rotation_seconds} seconds</p>
            </>
          )}
        </>
      )}
      <Link to="/" className="btn ghost small no-print">Exit</Link>
    </div>
  );
}
