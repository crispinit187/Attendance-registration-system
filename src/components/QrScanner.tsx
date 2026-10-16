import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Alert } from './ui';

/** Opens the back camera and calls onResult once with the first QR text found. */
export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  const done = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use the camera. Open the QR code with your phone camera app instead.');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = video.current!;
        v.srcObject = stream;
        v.setAttribute('playsinline', 'true');
        await v.play();
        const tick = () => {
          if (stopped || done.current) return;
          if (v.readyState === v.HAVE_ENOUGH_DATA && ctx) {
            const w = v.videoWidth, h = v.videoHeight;
            const scale = Math.min(1, 640 / Math.max(w, h));
            canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (code?.data) { done.current = true; onResult(code.data); return; }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        const m = (e as Error).message || '';
        setErr(/denied|permission|NotAllowed/i.test(m)
          ? 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.'
          : m || 'Could not start the camera.');
      }
    })();
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (err) return <Alert>{err}</Alert>;
  return (
    <div className="scanner">
      <video ref={video} muted />
      <div className="frame" />
    </div>
  );
}
