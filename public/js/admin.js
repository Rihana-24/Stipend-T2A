import { h, api, icon, fnum, fdate, fdt, mlabel, toast, modal, badge, spinner } from './lib.js';
import { EVENT_LABELS, assignModal, sendModal } from './staff.js';

const confirmModal = (title, text, label, run) => {
  const close = modal(h('div', {}, h('h2', {}, title), h('p', {}, text), h('div', { class: 'row mt', style: { justifyContent: 'flex-end' } },
    h('button', { class: 'btn', onclick: () => close() }, 'Annuler'), h('button', { class: 'btn primary', onclick: async (e) => { e.target.disabled = true; try { await run(); close(); } catch (er) { toast(er.message, 'err'); e.target.disabled = false; } } }, label))));
};

// ---------------------------------------------------------------- Envois
async function mailView({ go, S }) {
  const [em, st, cfg] = await Promise.all([api('/api/emails'), api('/api/stats'), api('/api/settings')]);
  const s = cfg.settings;
  const sum = em.summary;
  const run = (kind, target, label, text) => () => confirmModal(label, text, 'Envoyer', async () => {
    const r = await api('/api/invite', { method: 'POST', body: { kind, target } });
    if (!r.queued) { toast('Aucun nouvel e-mail : tous les Associates ciblés l’ont déjà reçu ce mois-ci.'); return go('mail'); }
    toast(r.mail_configured ? `${fnum(r.queued)} e-mail(s) en cours d’envoi ✓` : `${fnum(r.queued)} e-mail(s) en file — envoi non configuré`, r.mail_configured ? 'ok' : ''); go('mail');
  });
  return h('div', {},
    !em.configured ? h('div', { class: 'callout warn' }, h('b', {}, 'Envoi d’e-mails non configuré. '), 'Ajoutez la clé API Resend et votre adresse d’expéditeur (README, étape 5). En attendant, exportez les liens personnels et envoyez-les par WhatsApp.') : h('div', { class: 'callout ok' }, 'Envoi d’e-mails actif.'),
    h('div', { class: 'kpis' }, h('div', { class: 'kpi good' }, h('b', {}, fnum(sum.sent || 0)), h('span', {}, 'E-mails envoyés')), h('div', { class: 'kpi warn' }, h('b', {}, fnum(sum.pending || 0)), h('span', {}, 'En attente d’envoi')), h('div', { class: 'kpi bad' }, h('b', {}, fnum(sum.failed || 0)), h('span', {}, 'Échecs'))),
    h('div', { class: 'card' }, h('h2', {}, 'Envoyer maintenant'),
      h('p', { class: 'muted small' }, `Envoi automatique : le ${s.reminder_day} de chaque mois à 09:00 (UTC) à tous les Associates, puis relance aux non-répondants à J+${s.reminder_offsets.split(',').join(' et J+')}. Les TC reçoivent un récapitulatif des déclarations à valider.`),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: run('invite', 'all', 'Invitation à tous', `Envoyer l’invitation mensuelle aux ${fnum(st.totals.total)} Associates ?`) }, icon('mail'), 'Invitation à tous'),
        h('button', { class: 'btn', onclick: run('reminder', 'nonresponders', 'Relance', 'Relancer tous les Associates qui n’ont pas signé leur déclaration à jour ?') }, 'Relancer les non-répondants'),
        (sum.failed ? h('button', { class: 'btn', onclick: async () => { const r = await api('/api/emails/retry', { method: 'POST' }); toast(`${r.requeued} remis en file`); go('mail'); } }, 'Réessayer les échecs') : null),
        h('a', { class: 'btn', href: '/api/links', download: '' }, icon('download'), 'Liens personnels (CSV + WhatsApp)'))),
    h('div', { class: 'card' }, h('h2', {}, 'Derniers envois'),
      em.items.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Date', 'Associate', 'Type', 'Statut'].map((x) => h('th', {}, x)))),
        h('tbody', {}, em.items.map((m) => h('tr', { style: { cursor: 'default' } }, h('td', { class: 'small' }, fdt(m.created_at)), h('td', {}, m.full_name, h('div', { class: 'small muted' }, m.to_email)),
          h('td', {}, { invite: 'Invitation', reminder: 'Rappel', dispute: 'Correction', link: 'Lien perdu' }[m.kind] || m.kind),
          h('td', {}, m.status === 'sent' ? badge('Envoyé', 'b-green') : m.status === 'failed' ? badge('Échec', 'b-red') : badge('En attente', 'b-amber'), m.error ? h('div', { class: 'small muted' }, m.error) : null)))))) : h('div', { class: 'empty' }, 'Aucun envoi pour le moment.')));
}

// ---------------------------------------------------------------- Équipe
async function teamView({ go, S }) {
  const [{ items }, f] = await Promise.all([api('/api/staff'), api('/api/filters')]);
  S.filters = f;
  const name = h('input', { class: 'input', placeholder: 'Nom et prénom' }), email = h('input', { class: 'input', type: 'email', placeholder: 'email@exemple.org' });
  const role = h('select', { class: 'input' }, h('option', { value: 'tc' }, 'TalentCorps (TC)'), h('option', { value: 'admin' }, 'Administrateur'));
  const bulkTa = h('textarea', { class: 'input', placeholder: 'Un TC par ligne :\nAwa Diop, awa.diop@exemple.org\nMoussa Ndiaye; moussa@exemple.org' });
  const add = async () => { try { await api('/api/staff', { method: 'POST', body: { name: name.value, email: email.value, role: role.value } }); toast('Ajouté ✓', 'ok'); go('team'); } catch (e) { toast(e.message, 'err'); } };
  const addBulk = async () => {
    const itemsB = bulkTa.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const p = l.split(/[;,\t]/).map((x) => x.trim()); return { name: p[0], email: p[1], role: 'tc' }; });
    try { const r = await api('/api/staff', { method: 'POST', body: { items: itemsB } }); toast(`${r.count} TC ajouté(s) ✓`, 'ok'); go('team'); } catch (e) { toast(e.message, 'err'); }
  };
  return h('div', {},
    h('div', { class: 'card' }, h('h2', {}, 'Équipe'), h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Nom', 'E-mail', 'Rôle', 'Associates', ''].map((x, i) => h('th', { class: i === 3 ? 'num' : '' }, x)))),
      h('tbody', {}, items.map((u) => h('tr', { style: { cursor: 'default', opacity: u.active ? 1 : .5 } }, h('td', {}, h('b', {}, u.name)), h('td', { class: 'small' }, u.email), h('td', {}, u.role === 'admin' ? badge('Admin', 'b-blue') : badge('TC', 'b-green')), h('td', { class: 'num' }, u.associates || 0),
        h('td', {}, h('button', { class: 'btn sm', onclick: async () => { try { await api(`/api/staff/${u.id}`, { method: 'PATCH', body: { active: !u.active } }); go('team'); } catch (e) { toast(e.message, 'err'); } } }, u.active ? 'Désactiver' : 'Réactiver')))))))),
    h('div', { class: 'card' }, h('h2', {}, 'Ajouter un membre'), h('div', { class: 'filters' }, name, email, role, h('button', { class: 'btn primary', onclick: add }, 'Ajouter')),
      h('details', { class: 'mt-s' }, h('summary', { class: 'small', style: { cursor: 'pointer' } }, 'Ajouter plusieurs TC d’un coup'), bulkTa, h('button', { class: 'btn mt-s', onclick: addBulk }, 'Ajouter la liste'))),
    h('div', { class: 'card' }, h('h2', {}, 'Rattacher selon le TC choisi par les Associates'),
      h('p', { class: 'muted small' }, 'Les Associates sans TC assigné qui ont choisi un TC dans le menu déroulant sont rattachés automatiquement au compte TC du même nom.'),
      h('button', { class: 'btn primary', onclick: async (e) => { e.target.disabled = true; try { const r = await api('/api/associates/assign-declared', { method: 'POST' }); toast(`${r.updated} Associate(s) rattaché(s). ${r.unmatched} sans compte TC correspondant.`, r.unmatched ? '' : 'ok'); go('team'); } catch (er) { toast(er.message, 'err'); } e.target.disabled = false; } }, 'Rattacher maintenant')),
    h('div', { class: 'card' }, h('h2', {}, 'Assigner les TC par entreprise'), h('p', { class: 'muted small' }, 'Choisissez une entreprise : tous ses Associates sont rattachés au TC choisi. Pour un détail plus fin, utilisez l’onglet Associates (sélection multiple).'),
      h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, [h('th', {}, 'Entreprise'), h('th', { class: 'num' }, 'Associates'), h('th', {}, '')])),
        h('tbody', {}, f.employers.sort((a, b) => b.n - a.n).map((e) => h('tr', { style: { cursor: 'default' } }, h('td', {}, e.employer), h('td', { class: 'num' }, e.n), h('td', {}, h('button', { class: 'btn sm', onclick: () => assignModal(null, () => go('team'), { employer: e.employer }) }, 'Assigner un TC')))))))));
}

// ---------------------------------------------------------------- Import
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = [';', ',', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const FIELD_ALIASES = {
  id: ['id', 'associateid'], email: ['email', 'mail', 'courriel', 'emailpersonnel', 'personalemail'], first_name: ['prenom', 'prenoms', 'firstname'], last_name: ['nom', 'lastname'],
  full_name: ['nometprenom', 'nometprenoms', 'nomcomplet', 'fullname', 'nomprenom', 'prenomnom'], phone: ['telephone', 'phone', 'tel', 'mobile', 'numerodetelephone', 'mobilephone'],
  employer: ['entreprise', 'employer', 'employerorganization', 'societe', 'organisation'], tc: ['tc', 'tcreferent', 'talentcorps', 'tcassigne', 'nomdutc'],
  start_date: ['datededemarrage', 'startdate', 'datedebut', 'datededemarragedustage', 'datedeprisedefonction'], country: ['pays', 'paysderesidence', 'country'],
};
const FIELD_LABELS = { id: 'Associate ID', email: 'E-mail *', first_name: 'Prénom', last_name: 'Nom', full_name: 'Nom complet', phone: 'Téléphone', employer: 'Entreprise', tc: 'TC référent (nom ou e-mail)', start_date: 'Date de démarrage', country: 'Pays' };
const toISODate = (v) => { v = String(v || '').trim(); let m; if ((m = v.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`; if ((m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return ''; };

async function importView({ go }) {
  const out = h('div'), preview = h('div');
  let table = null, map = {};
  const file = h('input', { type: 'file', accept: '.csv,text/csv,text/plain', class: 'input', onchange: async () => {
    const f = file.files[0]; if (!f) return;
    table = parseCSV(await f.text());
    if (table.length < 2) { preview.replaceChildren(h('div', { class: 'callout bad' }, 'Fichier vide ou illisible.')); return; }
    const head = table[0].map(norm);
    map = {};
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) { const i = head.findIndex((x) => aliases.includes(x)); if (i >= 0) map[field] = i; }
    paintPreview();
  } });
  function paintPreview() {
    const body = table.slice(1);
    const sels = Object.entries(FIELD_LABELS).map(([field, label]) => h('div', {}, h('label', { class: 'f' }, label), h('select', { class: 'input', onchange: (e) => { if (e.target.value === '') delete map[field]; else map[field] = +e.target.value; } },
      h('option', { value: '' }, '— ignorer —'), table[0].map((c, i) => h('option', { value: i, selected: map[field] === i }, c || `Colonne ${i + 1}`)))));
    const go2 = h('button', { class: 'btn primary', onclick: doImport }, `Importer ${fnum(body.length)} ligne(s)`);
    preview.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Vérifier les colonnes'), h('p', { class: 'muted small' }, 'Les Associates déjà présents (même e-mail) sont mis à jour : entreprise, téléphone, date de démarrage, TC. Les nouveaux sont créés avec leur lien personnel.'),
      h('div', { class: 'filters' }, sels), !map.email ? h('div', { class: 'callout bad' }, 'Colonne e-mail introuvable : sélectionnez-la.') : null,
      h('div', { class: 'tablewrap mt-s' }, h('table', {}, h('thead', {}, h('tr', {}, table[0].map((c) => h('th', {}, c)))), h('tbody', {}, body.slice(0, 5).map((r) => h('tr', { style: { cursor: 'default' } }, table[0].map((_, i) => h('td', { class: 'small' }, r[i] || ''))))))),
      h('div', { class: 'row mt' }, go2)));
  }
  async function doImport() {
    if (map.email == null) return toast('Sélectionnez la colonne e-mail', 'err');
    const body = table.slice(1).map((r) => { const o = {}; for (const [f, i] of Object.entries(map)) o[f] = (r[i] || '').trim(); if (o.start_date) o.start_date = toISODate(o.start_date); return o; });
    const prog = h('div', { class: 'bar' }, h('i', { class: 'g', style: { width: '0%' } }));
    out.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Import en cours…'), prog));
    let created = 0, updated = 0, skipped = [], unmatched = new Set();
    try {
      for (let i = 0; i < body.length; i += 100) {
        const r = await api('/api/associates/import', { method: 'POST', body: { rows: body.slice(i, i + 100) } });
        created += r.created; updated += r.updated; r.skipped.forEach((s) => skipped.push({ row: i + s.row + 1, reason: s.reason })); r.unmatched_tc.forEach((t) => unmatched.add(t));
        prog.firstChild.style.width = Math.round(((i + 100) / body.length) * 100) + '%';
      }
      preview.replaceChildren();
      out.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Import terminé ✓'), h('p', {}, `${fnum(created)} créé(s) · ${fnum(updated)} mis à jour · ${skipped.length} ignoré(s)`),
        unmatched.size ? h('div', { class: 'callout warn' }, 'TC introuvables (ajoutez-les dans l’onglet Équipe puis réimportez) : ', [...unmatched].join(', ')) : null,
        skipped.length ? h('details', {}, h('summary', {}, 'Lignes ignorées'), h('ul', {}, skipped.slice(0, 50).map((s) => h('li', {}, `Ligne ${s.row} : ${s.reason}`)))) : null,
        h('button', { class: 'btn primary mt-s', onclick: () => go('list') }, 'Voir les Associates')));
    } catch (e) { out.replaceChildren(h('div', { class: 'callout bad' }, e.message)); }
  }
  const tpl = () => { const b = new Blob(['﻿Associate ID;Nom;Prénom;Email;Téléphone;Entreprise;TC référent;Date de démarrage\n;Diop;Awa;awa.diop@exemple.com;221771234567;ACME SARL;Moussa Ndiaye;2026-06-15\n'], { type: 'text/csv' }); const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(b), download: 'modele-import.csv' }); a.click(); };
  return h('div', {}, h('div', { class: 'card' }, h('h2', {}, 'Importer ou mettre à jour des Associates'),
    h('p', { class: 'muted' }, 'Les 704 Associates actuels sont déjà chargés. Utilisez l’import pour ajouter de nouveaux Associates, ou renseigner en masse les TC référents, entreprises et dates de démarrage (fichier CSV exporté depuis Excel).'),
    h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: tpl }, icon('download', 16), 'Télécharger le modèle CSV')), h('label', { class: 'f' }, 'Fichier CSV'), file), preview, out);
}

// ---------------------------------------------------------------- Paramètres
async function settingsView({ go }) {
  const { settings: s, has_signature, mail_configured, app_url, mail_from } = await api('/api/settings');
  const inp = (key, label, attrs = {}, hint) => h('div', {}, h('label', { class: 'f' }, label), h('input', { class: 'input', id: 's-' + key, value: s[key] ?? '', ...attrs }), hint ? h('div', { class: 'hint' }, hint) : null);
  const save = async () => {
    const body = {}; for (const k of Object.keys(s)) { const el = document.getElementById('s-' + k); if (el) body[k] = el.value; }
    try { await api('/api/settings', { method: 'PUT', body }); toast('Paramètres enregistrés ✓', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
  const sigPrev = h('div', {}, has_signature ? h('img', { src: '/api/settings/signature?' + Date.now(), alt: 'Signature du signataire', style: { maxHeight: '70px', border: '1px solid var(--line)', borderRadius: '8px', padding: '6px', background: '#fff' } }) : h('p', { class: 'muted small' }, 'Aucune signature enregistrée : l’attestation affichera uniquement le nom et la fonction.'));
  const sigFile = h('input', { type: 'file', accept: 'image/png', class: 'input', onchange: async () => {
    const fd = new FormData(); fd.append('file', sigFile.files[0]);
    try { await api('/api/settings/signature', { method: 'POST', form: fd }); toast('Signature enregistrée ✓', 'ok'); go('settings'); } catch (e) { toast(e.message, 'err'); }
  } });
  return h('div', {},
    h('div', { class: 'card' }, h('h2', {}, 'Collecte'), h('div', { class: 'cols' },
      inp('program_start', 'Premier mois du programme', { type: 'month' }, 'Les mois affichés aux Associates vont de ce mois jusqu’au mois en cours.'),
      inp('deadline', 'Date limite de collecte', { type: 'date' }), inp('reminder_day', 'Jour d’envoi mensuel (1–28)', { type: 'number', min: 1, max: 28 }),
      inp('reminder_offsets', 'Relances (jours après l’envoi)', { placeholder: '3,5' }, 'Ex. 3,5 → relance à J+3 et J+5 pour ceux qui n’ont pas répondu.'),
      inp('attestation_months', 'Mois couverts par l’attestation', { type: 'number', min: 1, max: 12 }, 'Les N derniers mois confirmés par le TC.'))),
    h('div', { class: 'card' }, h('h2', {}, 'Liste des TalentCorps (menu déroulant des Associates)'),
      h('p', { class: 'muted small' }, 'Un nom par ligne. Les Associates sans TC assigné choisissent le leur dans cette liste. Pour que le rattachement automatique fonctionne, le nom doit être identique à celui du compte TC créé dans l’onglet Équipe.'),
      h('textarea', { class: 'input', id: 's-tc_names', rows: 12, style: { fontFamily: 'inherit' } }, s.tc_names || '')),
    h('div', { class: 'card' }, h('h2', {}, 'Attestations & contact'), h('div', { class: 'cols' }, inp('org_name', 'Organisation émettrice'), inp('signatory_name', 'Nom du signataire'), inp('signatory_title', 'Fonction du signataire'),
      inp('support_email', 'E-mail d’assistance (affiché aux Associates)', { type: 'email' })),
      h('label', { class: 'f' }, 'Signature du signataire (PNG, fond transparent)'), sigPrev, sigFile,
      h('div', { class: 'callout info mt-s mb0' }, 'Cette signature est apposée automatiquement sur les attestations. Ne l’enregistrez qu’avec l’accord du signataire : seuls les administrateurs y ont accès.')),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: save }, 'Enregistrer'), h('button', { class: 'btn', onclick: async (e) => { e.target.disabled = true; try { const r = await api('/api/backup', { method: 'POST' }); toast(`Sauvegarde créée : ${r.key}`, 'ok'); } catch (er) { toast(er.message, 'err'); } e.target.disabled = false; } }, icon('shield', 16), 'Sauvegarder maintenant')),
    h('div', { class: 'card mt' }, h('h2', {}, 'Environnement'), h('div', { class: 'kv' }, h('b', {}, 'URL de l’application'), h('span', {}, app_url)), h('div', { class: 'kv' }, h('b', {}, 'Expéditeur des e-mails'), h('span', {}, mail_from || '—')),
      h('div', { class: 'kv' }, h('b', {}, 'Envoi d’e-mails'), h('span', {}, mail_configured ? badge('Actif', 'b-green') : badge('Non configuré', 'b-amber'))),
      h('p', { class: 'small muted mt-s mb0' }, 'Une sauvegarde complète (JSON) est créée automatiquement chaque mois dans R2, avec les 30 dernières conservées.')));
}

// ---------------------------------------------------------------- Journal
async function auditView() {
  const { items } = await api('/api/audit');
  return h('div', { class: 'card' }, h('h2', {}, 'Journal d’activité'), h('p', { class: 'muted small' }, 'Les 200 derniers événements (hors simples modifications de saisie).'),
    h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Date', 'Acteur', 'Action', 'Associate', 'Détail'].map((x) => h('th', {}, x)))),
      h('tbody', {}, items.map((e) => h('tr', { style: { cursor: 'default' } }, h('td', { class: 'small' }, fdt(e.created_at)), h('td', { class: 'small' }, e.actor === 'associate' ? 'Associate' : e.actor.replace('staff:', '')),
        h('td', {}, EVENT_LABELS[e.type] || e.type, e.month ? ` · ${mlabel(e.month)}` : ''), h('td', { class: 'small' }, e.full_name ? `${e.full_name} (${e.ref})` : '—'),
        h('td', { class: 'small muted' }, e.data ? JSON.stringify(e.data).slice(0, 120) : '')))))));
}

export const views = { mail: mailView, team: teamView, import: importView, settings: settingsView, audit: auditView };
