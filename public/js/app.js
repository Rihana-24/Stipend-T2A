import { h, api, icon, fdate, fcfa, spinner, brandBar } from './lib.js';

const root = document.getElementById('app');
const topbar = (right) => brandBar(right);

function landing() {
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', inputmode: 'email', placeholder: 'votre.email@exemple.com', required: true });
  const out = h('div');
  const btn = h('button', { class: 'btn primary block mt-s', type: 'submit' }, icon('mail'), ' Recevoir mon lien');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; out.replaceChildren();
    try { await api('/api/a/resend', { method: 'POST', body: { email: email.value } }); out.replaceChildren(h('div', { class: 'callout ok mt-s mb0' }, 'Si cette adresse figure dans la liste des Associates, un e-mail contenant votre lien personnel vient de vous être envoyé. Pensez à vérifier vos courriers indésirables.')); }
    catch (er) { out.replaceChildren(h('div', { class: 'err' }, er.message)); }
    btn.disabled = false;
  } }, h('label', { class: 'f' }, 'Adresse e-mail utilisée pour votre candidature Academy4Africa'), email, btn, out);
  root.replaceChildren(topbar(h('a', { class: 'btn sm ghost', href: '/staff' }, 'Espace équipe')), h('div', { class: 'wrap' },
    h('div', { class: 'hero' }, h('h1', {}, 'Suivi des stipends'), h('p', {}, 'Programme Associates · confirmez la réception de vos indemnités de stage et ajoutez vos justificatifs.')),
    h('div', { class: 'card' }, h('h2', {}, 'Retrouver mon lien personnel'), h('p', { class: 'muted small' }, 'Chaque Associate dispose d’un lien personnel et sécurisé, envoyé par e-mail. Vous l’avez perdu ? Demandez-le à nouveau.'), form)));
}

async function verify(code) {
  root.replaceChildren(topbar(), h('div', { class: 'wrap' }, spinner('Vérification…')));
  let r; try { r = await api(`/api/verify/${encodeURIComponent(code)}`); } catch { r = { valid: false }; }
  const body = r.valid
    ? h('div', { class: 'card center' }, h('div', { class: 'done-ic' }, icon('shield', 36)), h('h2', {}, 'Attestation authentique'),
        h('p', { class: 'muted' }, `Référence ${r.code} · émise le ${fdate(r.issued_at)} par ${r.org}`),
        h('div', { class: 'card flat', style: { textAlign: 'left' } }, h('div', { class: 'kv' }, h('b', {}, 'Associate'), h('span', {}, r.name)), r.employer ? h('div', { class: 'kv' }, h('b', {}, 'Entreprise'), h('span', {}, r.employer)) : null,
          r.months.map((m) => h('div', { class: 'kv' }, h('b', {}, m.label), h('span', {}, `${fcfa(m.amount)} · reçu le ${fdate(m.date)}`))), h('div', { class: 'kv' }, h('b', {}, 'Total'), h('span', {}, h('b', { style: { textTransform: 'none', fontSize: '1rem', color: 'var(--green-d)' } }, fcfa(r.total))))))
    : h('div', { class: 'card center' }, h('h2', {}, 'Attestation introuvable'), h('p', { class: 'muted' }, 'Ce code ne correspond à aucune attestation valide. Vérifiez le code ou contactez Talent2Africa.'));
  root.replaceChildren(topbar(), h('div', { class: 'wrap' }, body));
}

async function route() {
  const p = location.pathname;
  let m;
  if ((m = p.match(/^\/a\/([\w-]+)\/?$/))) return (await import('./associate.js')).renderAssociate(root, m[1]);
  if ((m = p.match(/^\/verify\/([\w-]+)\/?$/))) return verify(m[1]);
  if (p === '/staff' || p.startsWith('/staff/')) return (await import('./staff.js')).renderStaff(root, topbar);
  landing();
}
route().catch((e) => { console.error(e); root.replaceChildren(h('div', { class: 'wrap' }, h('div', { class: 'card' }, h('h2', {}, 'Erreur de chargement'), h('p', {}, e.message), h('a', { class: 'btn', href: '/' }, 'Accueil')))); });
