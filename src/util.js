export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
export const fail = (status, message, extra) => {
  throw new HttpError(status, message, extra);
};

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export const nowISO = () => new Date().toISOString();
export const today = () => nowISO().slice(0, 10);
export const currentMonth = () => nowISO().slice(0, 7);

const enc = new TextEncoder();
export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function randToken(n = 24) {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}
export async function sha256Hex(data) {
  const buf = await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function timingSafeEqual(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
export function bytesToBase64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}
export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
export const monthLabel = (ym) => `${MONTHS_FR[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`;
export function monthsRange(start, end) {
  const out = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
export const prevMonth = (ym) => {
  let [y, m] = ym.split('-').map(Number);
  if (--m < 1) { m = 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
};

export const DEFAULT_SETTINGS = {
  placement_targets: '{"sn":800,"bjtg":500,"ci":100,"bfne":100,"cmcd":100,"other":200}',
  placed_file: '{}',
  program_start: '2026-06',
  deadline: '2026-11-15',
  reminder_day: '10',
  reminder_offsets: '3,5',
  attestation_months: '3',
  org_name: 'Talent2Africa',
  signatory_name: '',
  signatory_title: '',
  support_email: '',
  support_whatsapp: '',
  // Liste des TalentCorps proposée en menu déroulant aux Associates (un nom par ligne, modifiable dans Paramètres).
  tc_names: "Amadou SAVANE\nAnne Marie AWADJIHE\nAffi Noelline AYEBOU\nChambeline NKAH\nCocou Emmanuelle\nDaniel Ngamda ASAAH\nDorcas ASSOGBA\nGaspard SEBIO\nGuy AHONAKPON\nFatou Bintou SENE\nJean Paul NDIAYE\nIsrael BAELONGANDI\nKhalifa Babacar SEYIDI\nLiwa Augustine TAWE\nModestine SODANSOU\nMaurice DJIVO\nRihanatou BANKOLE\nSouleymane SAYORE\nSamuel TOHOUEGNON\nUrbain ESSEHO\nZainab FAROUK",
};

export const tcOptions = (s) => [...new Set(String(s.tc_names || '').split('\n').map((x) => x.trim()).filter(Boolean))];
export async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of results) if (r.key in DEFAULT_SETTINGS) s[r.key] = r.value;
  return s;
}
export const programMonths = (s) => monthsRange(s.program_start, currentMonth());
// Mois « échus » : tous sauf le mois en cours (le stipend du mois courant peut ne pas être encore versé).
export const dueMonths = (s) => programMonths(s).filter((m) => m < currentMonth());

export const clientIP = (req) => req.headers.get('cf-connecting-ip') || '';
export const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise l'injection de formules Excel
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export const toCSV = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');

export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e || '');
export const normPhone = (p) => {
  const d = String(p || '').replace(/[^\d+]/g, '');
  const digits = d.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
};
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s));
export const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');

export async function logEvent(env, associateId, actor, type, month = null, data = null) {
  return env.DB.prepare('INSERT INTO events (associate_id, actor, type, month, data, created_at) VALUES (?,?,?,?,?,?)')
    .bind(associateId, actor, type, month, data ? JSON.stringify(data) : null, nowISO())
    .run();
}

// Contrôle du type réel du fichier (octets magiques), jamais l'en-tête déclaré par le client.
export function sniffMime(b) {
  const eq = (o, arr) => arr.every((v, i) => b[o + i] === v);
  if (eq(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (eq(0, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (eq(0, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
  if (eq(0, [0x52, 0x49, 0x46, 0x46]) && eq(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  if (eq(4, [0x66, 0x74, 0x79, 0x70]) && /^(heic|heix|mif1|msf1)$/.test(String.fromCharCode(...b.slice(8, 12)))) return 'image/heic';
  return null;
}
export const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'image/webp': 'webp', 'image/heic': 'heic' };

// ---- Placements : groupes de pays (objectifs du programme) ----
export const GROUPS = [
  { key: 'sn', label: 'Sénégal', countries: ['Sénégal'] },
  { key: 'bjtg', label: 'Bénin + Togo', countries: ['Bénin', 'Togo'] },
  { key: 'ci', label: 'Côte d’Ivoire', countries: ['Côte d\'Ivoire', 'Côte d’Ivoire'] },
  { key: 'bfne', label: 'Burkina Faso + Niger', countries: ['Burkina Faso', 'Niger'] },
  { key: 'cmcd', label: 'Cameroun + RD Congo', countries: ['Cameroun', 'RD Congo', 'République démocratique du Congo'] },
  { key: 'other', label: 'Autres pays francophones', countries: [] },
];
export const groupOf = (country) => (GROUPS.find((g) => g.countries.some((c) => c.toLowerCase() === String(country || '').trim().toLowerCase())) || GROUPS[5]).key;
export const DEFAULT_RATE = 130000;

// ID au format du rapport CFA : identifiant Academy4Africa sans tirets + « TA »
export const cfaId = (id) => String(id || '').replace(/-/g, '').toLowerCase() + 'TA';
