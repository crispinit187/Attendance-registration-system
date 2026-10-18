import { Icon } from './ui';
import { dismissHeld, flush, useOfflineState, useOnline } from '../lib/offline';

/** Shows when marks are waiting on this device, when they are being sent, and when something needs attention. */
export function OfflineBar({ onDone }: { onDone: () => void }) {
  const { queue, held, syncing, lastError } = useOfflineState();
  const online = useOnline();
  if (online && !queue.length && !held.length && !lastError) return null;
  return (
    <div className="offbar" role="status" aria-live="polite">
      {(!online || queue.length > 0 || lastError) && (
        <div className={`offrow ${online && !lastError ? 'sync' : 'off'}`}>
          <Icon name={online ? 'down' : 'warn'} size={18} />
          <div className="grow">
            {!online
              ? <b>No connection.</b>
              : syncing ? <b>Sending…</b> : lastError ? <b>Could not send.</b> : <b>Waiting to send.</b>}{' '}
            {queue.length > 0
              ? `${queue.length} ${queue.length === 1 ? 'change is' : 'changes are'} saved on this device${!online ? ' and will be sent when you are back online.' : '.'}`
              : !online ? 'You can keep working on lists you already opened.' : ''}
            {lastError && <div className="small">{lastError}</div>}
          </div>
          {online && queue.length > 0 && !syncing && <button className="btn small" onClick={() => { void flush(onDone); }}>Send now</button>}
        </div>
      )}
      {held.map((h) => (
        <div key={h.id} className={`offrow ${h.kind === 'approval' ? 'warn' : 'off'}`}>
          <Icon name="warn" size={18} />
          <div className="grow"><b>{h.label}</b><div className="small">{h.message}</div></div>
          <button className="btn small ghost" onClick={() => dismissHeld(h.id)}>OK</button>
        </div>
      ))}
    </div>
  );
}
