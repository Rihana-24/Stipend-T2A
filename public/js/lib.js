// Petites briques partagées : DOM sans innerHTML (pas d'injection), appels API, formats, toasts, modales.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {}).sort(([a], [b]) => (b === 'type') - (a === 'type'))) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'readOnly' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

const ICONS = {
  check: '<path d="M5 13l4 4L19 7"/>', upload: '<path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13" r="3.5"/>',
  file: '<path d="M7 3h7l5 5v12a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v5h5"/>',
  download: '<path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>', alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4m0 3v.01"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>', link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 14.5a6.5 6.5 0 013.5 5.5"/>', shield: '<path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
};
export function icon(name, size = 18) {
  const s = document.createElement('span');
  s.style.cssText = `display:inline-flex;width:${size}px;height:${size}px;flex:none`;
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`; // constantes internes uniquement
  return s;
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: { 'x-requested-with': 't2a' }, credentials: 'same-origin' };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opts); }
  catch { throw Object.assign(new Error('Connexion impossible. Vérifiez votre réseau puis réessayez.'), { status: 0 }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Erreur ${res.status}`), { status: res.status, data });
  return data;
}

export const fcfa = (n) => (n == null ? '—' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' FCFA');
export const fnum = (n) => String(n ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const fdate = (d) => (d ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T12:00:00Z' : d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
export const fdt = (d) => (d ? new Date(d.endsWith('Z') ? d : d + 'Z').toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const MONTHS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
export const mlabel = (ym) => { const m = MONTHS[+ym.slice(5, 7) - 1]; return m[0].toUpperCase() + m.slice(1) + ' ' + ym.slice(0, 4); };

export function toast(msg, type = '') {
  const box = document.getElementById('toasts');
  [...box.children].forEach((c) => { if (c.textContent === msg) c.remove(); });   // pas de doublons empilés
  while (box.children.length >= 2) box.firstChild.remove();                        // 2 notifications max à l'écran
  const t = h('div', { class: 'toast ' + type }, msg);
  box.append(t);
  setTimeout(() => t.remove(), type === 'err' ? 6000 : 2800);
}
export function modal(content, { onClose } = {}) {
  const close = () => { bg.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = (e) => e.key === 'Escape' && close();
  const bg = h('div', { class: 'modal-bg', onclick: (e) => e.target === bg && close() }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, content));
  document.addEventListener('keydown', esc);
  document.body.append(bg);
  return close;
}
export const debounce = (fn, ms = 500) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); return fn(...a); }; d.cancel = () => clearTimeout(t); return d; };
export const spinner = (label = 'Chargement…') => h('div', { class: 'loading' }, h('span', { class: 'spin' }), h('p', { class: 'muted mt-s' }, label));

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copié ✓', 'ok'); }
  catch { prompt('Copiez ce texte :', text); }
}

// Réduit les photos de téléphone (≈ 4–8 Mo) à ~300 Ko : upload rapide même avec une connexion faible.
export async function prepareProof(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/heic' || file.size < 450_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}

export const REVIEW = {
  pending: ['À valider', 'b-amber'], confirmed: ['Confirmé par le TC', 'b-green'], disputed: ['Correction demandée', 'b-red'],
};
export const badge = (text, cls) => h('span', { class: 'badge ' + cls }, text);

// En-tête commun : Mastercard Foundation à gauche, Talent2Africa à droite (les actions s'insèrent avant le logo T2A).
export function brandBar(actions) {
  return h('header', { class: 'topbar' }, h('div', { class: 'in' },
    h('a', { href: '/', class: 'brand-l', 'aria-label': 'Mastercard Foundation · Associates Program' }, h('img', { src: '/logo-mcf.png', alt: 'Mastercard Foundation · Associates Program' })),
    h('div', { class: 'brand-r' }, actions ? [h('div', { class: 'acts' }, actions), h('span', { class: 'sep', 'aria-hidden': 'true' })] : null, h('img', { src: '/logo-t2a.png', alt: 'Talent2Africa' }))));
}
