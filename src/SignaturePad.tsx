import { useRef, useState } from "react";

export type Signature = { x: number; y: number }[][];
export function SignaturePad({ value, onChange, label, clear }: {
  value: Signature; onChange: (value: Signature) => void; label: string; clear: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useRef(false);
  const strokes = useRef(value);
  const [drawing, setDrawing] = useState(false);
  strokes.current = value;
  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    // Normalized coordinates preserve the attestation across different screen sizes.
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!active.current) return;
    const all = strokes.current;
    if (all.reduce((count, stroke) => count + stroke.length, 0) >= 600) return;
    const stroke = all[all.length - 1], previous = stroke[stroke.length - 1], next = point(event);
    const context = canvas.current?.getContext("2d");
    if (context) {
      context.lineWidth = 2; context.lineCap = "round"; context.strokeStyle = "#111";
      context.beginPath(); context.moveTo(previous.x * 600, previous.y * 200); context.lineTo(next.x * 600, next.y * 200); context.stroke();
    }
    const updated = [...all.slice(0, -1), [...stroke, next]];
    strokes.current = updated; onChange(updated);
  }
  return <div className="signature-wrap"><label>{label}</label><canvas ref={canvas} width={600} height={200} className="signature-pad" aria-label={label}
    onPointerDown={(event) => {
      if (strokes.current.length >= 100) return;
      event.currentTarget.setPointerCapture(event.pointerId); active.current = true; setDrawing(true);
      const updated = [...strokes.current, [point(event)]];
      strokes.current = updated; onChange(updated);
    }} onPointerMove={draw} onPointerUp={(event) => {
      draw(event); active.current = false; setDrawing(false);
    }} onPointerCancel={() => { active.current = false; setDrawing(false); }} />
    <button type="button" disabled={drawing} onClick={() => { canvas.current?.getContext("2d")?.clearRect(0, 0, 600, 200); strokes.current = []; onChange([]); }}>{clear}</button></div>;
}
