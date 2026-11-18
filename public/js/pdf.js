// Attestation PDF générée dans le navigateur : 0 coût serveur, aucune limite de CPU Worker.
import { mlabel } from './lib.js';

async function loadPdfLib() {
  if (window.PDFLib) return window.PDFLib;
  await new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = '/vendor/pdf-lib.min.js'; s.onload = ok; s.onerror = () => ko(new Error('Impossible de charger le module PDF'));
    document.head.append(s);
  });
  return window.PDFLib;
}

const KEEP = new Set('’‘“”–—…€•'.split(''));
const safe = (s) => [...String(s ?? '').normalize('NFC')].map((c) => {
  const n = c.charCodeAt(0);
  if (n === 10) return '\n';
  if (n < 32) return ' ';
  if (n <= 255 || KEEP.has(c)) return c;
  const d = c.normalize('NFD')[0];
  return d && d.charCodeAt(0) <= 255 ? d : '?';
}).join('');
const money = (n) => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const dfr = (d) => (d ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T12:00:00Z' : d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
const b64 = (u) => Uint8Array.from(atob(u.split(',')[1]), (c) => c.charCodeAt(0));

export async function buildAttestation(p) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  doc.setTitle('Attestation de réception de stipends'); doc.setAuthor('Talent2Africa'); doc.setSubject(p.code);
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), ital = await doc.embedFont(StandardFonts.HelveticaOblique);
  const green = rgb(0.122, 0.416, 0.322), ink = rgb(0.11, 0.17, 0.15), grey = rgb(0.4, 0.45, 0.43), line = rgb(0.85, 0.89, 0.87);
  const M = 52, W = 595.28 - 2 * M;
  let y = 841.89 - 46;

  const text = (t, x, yy, o = {}) => page.drawText(safe(t), { x, y: yy, size: o.size || 10.5, font: o.font || font, color: o.color || ink });
  const width = (t, f = font, s = 10.5) => f.widthOfTextAtSize(safe(t), s);
  function wrap(t, f, s, maxW) {
    const out = [];
    for (const para of safe(t).split('\n')) {
      let cur = '';
      for (const word of para.split(/\s+/)) {
        const next = cur ? cur + ' ' + word : word;
        if (f.widthOfTextAtSize(next, s) > maxW && cur) { out.push(cur); cur = word; } else cur = next;
      }
      out.push(cur);
    }
    return out;
  }

  // En-tête : logos du programme
  try {
    const [l1, l2] = await Promise.all([fetch('/logo-mcf.png'), fetch('/logo-t2a.png')].map(async (f) => doc.embedPng(await (await f).arrayBuffer())));
    const h1 = 62, w1 = (l1.width / l1.height) * h1, w2 = 128, h2 = (l2.height / l2.width) * w2;
    page.drawImage(l1, { x: M - 2, y: y - h1 + 6, width: w1, height: h1 });
    page.drawImage(l2, { x: M + W - w2, y: y - h1 / 2 - h2 / 2 + 6, width: w2, height: h2 });
    y -= h1 + 14;
  } catch { y -= 20; }
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 1.2, color: green });
  y -= 40;
  const title = 'ATTESTATION DE RÉCEPTION DE STIPENDS';
  text(title, M + (W - width(title, bold, 17)) / 2, y, { font: bold, size: 17, color: green });
  y -= 18;
  const sub = `Référence ${p.code} · émise le ${dfr(p.issued_at)}`;
  text(sub, M + (W - width(sub, font, 9.5)) / 2, y, { size: 9.5, color: grey });
  y -= 36;

  const a = p.snapshot.associate;
  const intro = `Talent2Africa, dans le cadre du Programme Associates de la Mastercard Foundation, atteste que ${a.name}${a.employer ? `, Associate au sein de ${a.employer}` : ''}${a.country ? ` (${a.country})` : ''}, a déclaré avoir reçu les stipends (indemnités de stage) détaillés ci-dessous, et que ces déclarations ont été vérifiées et confirmées par son TalentCorps (TC) référent.`;
  for (const l of wrap(intro, font, 11, W)) { text(l, M, y, { size: 11 }); y -= 16; }
  y -= 14;

  // Tableau
  const cols = [M, M + 150, M + 290, M + W];
  page.drawRectangle({ x: M, y: y - 6, width: W, height: 24, color: green });
  ['Mois', 'Montant reçu (FCFA)', 'Date de réception', ''].forEach((t, i) => i < 3 && text(t, cols[i] + 10, y + 2, { font: bold, size: 10, color: rgb(1, 1, 1) }));
  y -= 6;
  p.snapshot.months.forEach((m, i) => {
    y -= 26;
    if (i % 2 === 0) page.drawRectangle({ x: M, y: y - 6, width: W, height: 26, color: rgb(0.96, 0.975, 0.965) });
    text(m.label || mlabel(m.month), cols[0] + 10, y + 3, { font: bold });
    text(money(m.amount), cols[1] + 10, y + 3);
    text(dfr(m.date), cols[2] + 10, y + 3);
  });
  y -= 28;
  page.drawLine({ start: { x: M, y: y + 22 }, end: { x: M + W, y: y + 22 }, thickness: 0.8, color: green });
  text('Total', cols[0] + 10, y + 3, { font: bold, size: 11.5 });
  text(`${money(p.snapshot.total)} FCFA`, cols[1] + 10, y + 3, { font: bold, size: 11.5, color: green });
  y -= 34;

  const note = "Cette attestation est délivrée pour servir et valoir ce que de droit. Son authenticité peut être vérifiée à tout moment à l'adresse et avec le code indiqués en bas de page.";
  for (const l of wrap(note, ital, 10, W)) { text(l, M, y, { font: ital, size: 10, color: grey }); y -= 14; }

  // Signatures
  const sy = 215;
  page.drawLine({ start: { x: M, y: sy + 120 }, end: { x: M + W, y: sy + 120 }, thickness: 0.5, color: line });
  text("Signature de l'Associate", M, sy + 100, { font: bold, size: 10 });
  text(`Pour ${p.signatory.org || 'Talent2Africa'}`, M + 300, sy + 100, { font: bold, size: 10 });
  const place = async (dataUrl, x, maxW, maxH) => {
    if (!dataUrl) return;
    const img = await doc.embedPng(b64(dataUrl));
    const k = Math.min(maxW / img.width, maxH / img.height);
    page.drawImage(img, { x, y: sy + 30, width: img.width * k, height: img.height * k });
  };
  await place(p.associate_signature, M, 170, 60);
  await place(p.signatory.signature, M + 300, 170, 60);
  text(a.name, M, sy + 14, { size: 9.5 });
  if (p.associate_signed_at) text(`Signé électroniquement le ${dfr(p.associate_signed_at)}`, M, sy + 2, { size: 8.5, color: grey });
  if (p.signatory.name) text(p.signatory.name, M + 300, sy + 14, { size: 9.5 });
  if (p.signatory.title) text(p.signatory.title, M + 300, sy + 2, { size: 8.5, color: grey });

  // Cachet électronique (vectoriel)
  const cx = M + W - 52, cy = sy + 62;
  page.drawCircle({ x: cx, y: cy, size: 42, borderColor: green, borderWidth: 1.6, borderOpacity: 0.55 });
  page.drawCircle({ x: cx, y: cy, size: 37, borderColor: green, borderWidth: 0.6, borderOpacity: 0.55 });
  ['TALENT2AFRICA', 'DOCUMENT', 'VÉRIFIÉ'].forEach((t, i) => text(t, cx - width(t, bold, 7.5) / 2, cy + 10 - i * 11, { font: bold, size: 7.5, color: green }));

  // Pied de page : vérification
  page.drawLine({ start: { x: M, y: 92 }, end: { x: M + W, y: 92 }, thickness: 0.6, color: line });
  text(`Code de vérification : ${p.code}`, M, 74, { font: bold, size: 9.5, color: green });
  text(`Vérifier : ${p.verify_url}`, M, 60, { size: 8.5, color: grey });
  text('Document généré automatiquement. Les signatures électroniques ont été horodatées et conservées avec une empreinte numérique.', M, 44, { size: 7.5, color: grey });

  const bytes = await doc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
