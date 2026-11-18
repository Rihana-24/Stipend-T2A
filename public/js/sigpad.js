// Pavé de signature : souris, doigt ou stylet. Conserve les traits pour survivre à une rotation d'écran.
import { h } from './lib.js';

export function sigPad({ onChange } = {}) {
  const canvas = h('canvas', { 'aria-label': 'Zone de signature' });
  const ph = h('div', { class: 'ph' }, 'Signez ici avec le doigt ou la souris');
  const box = h('div', { class: 'sigbox' }, canvas, h('div', { class: 'line' }), ph);
  let strokes = [], cur = null, dpr = 1, w = 0, hh = 0;

  const ctx = () => canvas.getContext('2d');
  function fit() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    w = r.width; hh = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr);
    redraw();
  }
  function stroke(g, pts) {
    g.beginPath();
    if (pts.length === 1) { g.arc(pts[0][0], pts[0][1], 1.4, 0, 7); g.fill(); return; }
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const l = pts[pts.length - 1]; g.lineTo(l[0], l[1]); g.stroke();
  }
  function redraw() {
    const g = ctx(); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
    g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 2.6; g.strokeStyle = g.fillStyle = '#14213d';
    strokes.forEach((s) => stroke(g, s));
  }
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); cur = [pos(e)]; strokes.push(cur); ph.style.display = 'none'; redraw(); });
  canvas.addEventListener('pointermove', (e) => { if (!cur) return; e.preventDefault(); cur.push(pos(e)); redraw(); });
  const end = () => { if (cur) { cur = null; onChange?.(!isEmpty()); } };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('pointerleave', end);
  new ResizeObserver(fit).observe(canvas);

  function length() { let L = 0; for (const s of strokes) for (let i = 1; i < s.length; i++) L += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]); return L; }
  function isEmpty() { return length() < 90; }
  function clear() { strokes = []; cur = null; ph.style.display = ''; redraw(); onChange?.(false); }

  // Export PNG transparent, rogné autour de l'encre (rendu net dans l'attestation PDF).
  function toDataURL() {
    if (!strokes.length) return null;
    const xs = strokes.flat().map((p) => p[0]), ys = strokes.flat().map((p) => p[1]);
    const pad = 8, x0 = Math.max(0, Math.min(...xs) - pad), y0 = Math.max(0, Math.min(...ys) - pad);
    const x1 = Math.min(w, Math.max(...xs) + pad), y1 = Math.min(hh, Math.max(...ys) + pad);
    const out = document.createElement('canvas');
    out.width = Math.ceil((x1 - x0) * dpr); out.height = Math.ceil((y1 - y0) * dpr);
    const g = out.getContext('2d'); g.scale(dpr, dpr); g.translate(-x0, -y0);
    g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 2.6; g.strokeStyle = g.fillStyle = '#14213d';
    strokes.forEach((s) => stroke(g, s));
    return out.toDataURL('image/png');
  }
  return { el: box, clear, isEmpty, toDataURL };
}
