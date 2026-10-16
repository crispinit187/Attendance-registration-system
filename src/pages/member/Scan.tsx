import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { QrScanner } from '../../components/QrScanner';
import { Alert } from '../../components/ui';
import { MarkFlow, parseScan } from './MarkFlow';

/** In-app camera scanner (/app/scan). */
export function Scan() {
  const [found, setFound] = useState<{ listId: string; token: string } | null>(null);
  const [bad, setBad] = useState(false);
  const [round, setRound] = useState(0);
  return (
    <div className="page stack" style={{ paddingTop: 32 }}>
      <h1 style={{ fontSize: 24 }}>Scan the QR code</h1>
      {found ? <MarkFlow listId={found.listId} token={found.token} /> : (
        <>
          <p className="muted">Point your camera at the code shown at the venue.</p>
          <QrScanner key={round} onResult={(t) => {
            const p = parseScan(t);
            if (p) { setFound(p); setBad(false); } else { setBad(true); setRound((n) => n + 1); }
          }} />
          {bad && <Alert kind="warn">That QR code is not an attendance code. Try again.</Alert>}
        </>
      )}
    </div>
  );
}

/** Opened when someone scans the code with their phone's own camera app (/scan/:listId?k=…). */
export function ScanLanding() {
  const { listId } = useParams();
  const [sp] = useSearchParams();
  const token = sp.get('k');
  return (
    <div className="page stack">
      <h1>Attendance</h1>
      {listId && token ? <MarkFlow listId={listId} token={token} /> : <Alert>This QR code is incomplete. Please scan it again.</Alert>}
    </div>
  );
}
