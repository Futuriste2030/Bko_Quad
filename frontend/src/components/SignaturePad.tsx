import { useEffect, useRef } from 'react';

const WIDTH = 900;
const HEIGHT = 300;

/* Signature manuscrite : tracé au doigt ou à la souris, export PNG.
   Le fond blanc est cuit dans l'image pour un rendu net dans le PDF. */
export default function SignaturePad({ value, onChange, disabled }: {
  value: string;
  onChange: (dataUrl: string) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  function context(): CanvasRenderingContext2D | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    ctx.fillStyle = '#111';
    return ctx;
  }

  function reset() {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  useEffect(() => {
    reset();
  }, []);

  useEffect(() => {
    if (!value) reset();
  }, [value]);

  function point(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
    };
  }

  function down(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    last.current = point(event);
    const ctx = context();
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.arc(last.current.x, last.current.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    const next = point(event);
    const ctx = context();
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
    }
    last.current = next;
  }

  function up(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* déjà relâché */ }
    onChange(event.currentTarget.toDataURL('image/png'));
  }

  function clear() {
    reset();
    onChange('');
  }

  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        aria-label="Zone de signature manuscrite"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
      />
      <div className="signature-pad-foot">
        <span className="small muted">Dessinez votre signature dans le cadre.</span>
        <button type="button" className="btn btn-ghost" onClick={clear} disabled={disabled}>
          Effacer
        </button>
      </div>
    </div>
  );
}
