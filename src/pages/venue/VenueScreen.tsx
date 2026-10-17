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

  return (
    <div className="venue">
      {err && <Alert>{err}</Alert>}
      {!qr && !err && <Spinner />}
      {qr && (
        <>
          <h1 style={{ margin: 0 }}>{qr.title}</h1>
          <p className="muted" style={{ margin: 0, fontSize: '1.1rem' }}>Scan with your phone to mark your attendance</p>
          <div className="qrbox"><QRCodeSVG value={scanUrl(qr.list_id, qr.token)} size={Math.min(440, Math.floor(window.innerWidth * 0.78))} level="M" /></div>
        </>
      )}
      <Link to="/" className="btn ghost small no-print">Exit</Link>
    </div>
  );
}
