import { h, api, icon, fcfa, fnum, fdate, fdt, pct, mlabel, toast, modal, debounce, spinner, badge, copy, REVIEW } from './lib.js';
import { buildAttestation, downloadBlob } from './pdf.js';

export const EVENT_LABELS = {
  month_saved: 'Mois mis à jour', proof_uploaded: 'Justificatif ajouté', submitted: 'Déclaration signée', review_confirmed: 'Confirmé par le TC', review_disputed: 'Correction demandée',
  review_pending: 'Décision annulée', profile_saved: 'Profil mis à jour', attestation: 'Attestation générée', login: 'Connexion', bulk_assign: 'Assignation de TC', import: 'Import',
  mail_enqueued: 'Envoi d’e-mails', staff_added: 'Équipe modifiée', settings_updated: 'Paramètres modifiés', associate_updated: 'Fiche modifiée', link_regenerated: 'Lien régénéré',
  signatory_signature_updated: 'Signature du signataire modifiée', transfer_recorded: 'Virement enregistré', employers_updated: 'Financement des entreprises modifié',
};

const S = { user: null, tab: 'dash', filters: null, stats: null, list: { q: {}, offset: 0 } };

export async function renderStaff(root, topbar) {
  const url = new URL(location.href);
  const t = url.searchParams.get('t');
  if (t) return verifyScreen(root, topbar, t);
  root.replaceChildren(topbar(), h('div', { class: 'wrap' }, spinner()));
  const { user } = await api('/api/me');
  if (!user) return loginScreen(root, topbar);
  S.user = user;
  S.tab = (location.hash || '').slice(1) || 'dash';
  await shell(root, topbar);
}

// ---------------------------------------------------------------- Connexion
async function verifyScreen(root, topbar, token) {
  const out = h('div');
  const btn = h('button', { class: 'btn primary block', onclick: async () => {
    btn.disabled = true;
    try { await api('/api/auth/verify', { method: 'POST', body: { token } }); history.replaceState({}, '', '/staff'); renderStaff(root, topbar); }
    catch (e) { out.replaceChildren(h('div', { class: 'callout bad' }, e.message), h('a', { class: 'btn block', href: '/staff' }, 'Demander un nouveau lien')); btn.disabled = false; }
  } }, 'Me connecter');
  root.replaceChildren(topbar(), h('div', { class: 'wrap' }, h('div', { class: 'card center' }, h('div', { class: 'done-ic' }, icon('lock', 34)), h('h2', {}, 'Confirmer la connexion'), h('p', { class: 'muted' }, 'Cliquez pour ouvrir votre espace.'), btn, out)));
}

async function loginScreen(root, topbar) {
  const cfg = await api('/api/auth/config');
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', placeholder: 'prenom.nom@exemple.org', required: true });
  const pwd = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Mot de passe administrateur' });
  const out = h('div');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); out.replaceChildren();
    try {
      if (cfg.password && pwd.value) { await api('/api/auth/password', { method: 'POST', body: { email: email.value, password: pwd.value } }); return renderStaff(root, topbar); }
      const r = await api('/api/auth/request', { method: 'POST', body: { email: email.value } });
      out.replaceChildren(...[h('div', { class: 'callout ok' }, 'Si ce compte existe, un lien de connexion (valable 20 min) vient d’être envoyé par e-mail.'),
        r.dev_link ? h('a', { class: 'btn block', href: r.dev_link }, 'Mode test : ouvrir le lien') : null].filter(Boolean));
    } catch (er) { out.replaceChildren(h('div', { class: 'err' }, er.message)); }
  } }, h('label', { class: 'f' }, 'Adresse e-mail professionnelle'), email,
    cfg.password ? h('div', {}, h('label', { class: 'f' }, 'Mot de passe ', h('span', { class: 'opt' }, '(administrateur, facultatif)')), pwd) : null,
    h('button', { class: 'btn primary block mt', type: 'submit' }, icon('mail'), ' Recevoir mon lien de connexion'), out);
  root.replaceChildren(topbar(), h('div', { class: 'wrap' }, h('div', { class: 'card' }, h('h2', {}, 'Espace équipe Talent2Africa'), h('p', { class: 'muted small' }, 'Réservé aux administrateurs Talent2Africa et aux TalentCorps (TC). Vous êtes Associate ? Vous n’avez pas besoin de vous connecter ici : utilisez votre lien personnel, ou ', h('a', { href: '/' }, 'redemandez-le ici'), '.'), form)));
}

// ---------------------------------------------------------------- Coque
async function shell(root, topbar) {
  const isAdmin = S.user.role === 'admin';
  const tabs = [['dash', 'Vue d’ensemble'], ['list', 'Associates'], ['place', 'Placements & financement'], ...(isAdmin ? [['mail', 'Envois'], ['team', 'Équipe'], ['import', 'Import'], ['settings', 'Paramètres'], ['audit', 'Journal']] : [])];
  const content = h('div');
  const nav = h('div', { class: 'tabs', role: 'tablist' });
  const go = async (id, extra) => {
    S.tab = id; history.replaceState({}, '', '/staff#' + id);
    nav.replaceChildren(...tabs.map(([k, l]) => h('button', { class: 'tab', role: 'tab', 'aria-selected': String(k === id), onclick: () => go(k) }, l)));
    content.replaceChildren(spinner());
    try {
      const mod = ['mail', 'team', 'import', 'settings', 'audit'].includes(id) ? await import('./admin.js') : null;
      const view = id === 'dash' ? dashboard : id === 'list' ? associatesView : id === 'place' ? (await import('./placements.js')).placementsView : mod?.views[id];
      content.replaceChildren(await view({ go, S, extra }));
    } catch (e) {
      if (e.status === 401) return renderStaff(root, topbar);
      content.replaceChildren(h('div', { class: 'callout bad' }, e.message));
    }
  };
  const logout = h('button', { class: 'btn sm', onclick: async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/staff'; } }, 'Déconnexion');
  const who = h('span', { class: 'small muted hide-sm' }, `${S.user.name} · ${isAdmin ? 'Administrateur' : 'TC'}`);
  root.replaceChildren(topbar([who, logout]), h('div', { class: 'wrap wide' }, nav, content));
  S.filters = await api('/api/filters');
  go(tabs.some(([k]) => k === S.tab) ? S.tab : 'dash');
}

// ---------------------------------------------------------------- Tableau de bord
async function dashboard({ go }) {
  const d = await api('/api/stats'); S.stats = d;
  const t = d.totals;
  const kpi = (v, label, cls, onclick) => h('div', { class: 'kpi ' + (cls || ''), style: onclick ? { cursor: 'pointer' } : {}, onclick, tabindex: onclick ? 0 : null, role: onclick ? 'button' : null }, h('b', {}, v), h('span', {}, label));
  const open = (q) => () => { S.list = { q, offset: 0 }; go('list'); };
  const answered = t.submitted;
  const dl = d.days_left;
  const root = h('div');
  if (d.role === 'admin' && !d.mail.configured) root.append(h('div', { class: 'callout warn' }, h('b', {}, 'Envoi d’e-mails non configuré. '), 'Les messages restent en file d’attente. Ajoutez la clé Resend (voir le guide de déploiement) ou utilisez l’export des liens personnels (onglet Envois) pour contacter les Associates par WhatsApp.'));
  if (d.role === 'admin' && t.unassigned > 0) root.append(h('div', { class: 'callout info' }, `${fnum(t.unassigned)} Associates n’ont pas encore de TC référent. `, h('button', { class: 'btn sm', onclick: open({ tc: 'none' }) }, 'Les voir et assigner')));

  root.append(
    h('div', { class: 'card' }, h('div', { class: 'row between' },
      h('div', {}, h('h2', { class: 'mb0' }, d.deadline ? `Échéance de collecte : ${fdate(d.deadline)}` : 'Collecte des stipends'),
        h('span', { class: 'muted small' }, dl != null ? (dl >= 0 ? `${dl} jour(s) restant(s)` : `échéance dépassée de ${-dl} jour(s)`) : '')),
      h('div', { class: 'center' }, h('b', { style: { fontSize: '2rem', color: 'var(--green)' } }, pct(answered, t.total) + ' %'), h('div', { class: 'small muted' }, 'ont signé leur déclaration'))),
      h('div', { class: 'bar mt-s', role: 'img', 'aria-label': 'Avancement des réponses' }, h('i', { class: 'g', style: { width: pct(answered, t.total) + '%' } }), h('i', { class: 'a', style: { width: pct(t.draft, t.total) + '%' } })),
      h('div', { class: 'legend' }, h('span', {}, h('i', { style: { background: 'var(--green)' } }), `Signé (${fnum(answered)})`), h('span', {}, h('i', { style: { background: '#f0b04a' } }), `En cours (${fnum(t.draft)})`), h('span', {}, h('i', { style: { background: '#e8eeea' } }), `Pas commencé (${fnum(t.none)})`))),
    h('div', { class: 'kpis' },
      kpi(fnum(t.total), 'Associates suivis', '', open({})),
      kpi(fnum(t.with_stipend), 'Ont reçu au moins un stipend', 'good', open({ status: 'submitted' })),
      kpi(fnum(t.none), 'N’ont pas encore répondu', t.none ? 'warn' : '', open({ status: 'none' })),
      kpi(fnum(t.to_review), 'À valider par le TC', t.to_review ? 'warn' : '', open({ status: 'toreview' })),
      kpi(fnum(t.disputed), 'Corrections demandées', t.disputed ? 'bad' : '', open({ status: 'disputed' })),
      kpi(fnum(t.missing_proof), 'Preuves manquantes', t.missing_proof ? 'warn' : '', open({ status: 'noproof' })),
      kpi(fcfa(t.total_amount), "Total déclaré reçu", "good wide")),
    h('div', { class: 'card' }, h('h2', {}, 'Suivi des liens personnels'),
      h('p', { class: 'muted small' }, 'Envoyé = e-mail parti ou lien marqué envoyé (WhatsApp). Ouvert = l’Associate a cliqué sur son lien. Signé = déclaration signée.'),
      ...[['Liens envoyés', t.link_sent, 'linksent'], ['Liens ouverts', t.opened, 'opened'], ['Déclarations signées', answered, 'submitted'], ['Tout confirmé par le TC', t.fully_confirmed, 'confirmed']].map(([label, v, st]) =>
        h('div', { class: 'funnel', style: { cursor: 'pointer', margin: '8px 0' }, onclick: () => open({ status: st })() },
          h('div', { class: 'row between' }, h('span', {}, label), h('b', {}, `${fnum(v)} / ${fnum(t.total)} · ${pct(v, t.total)} %`)), h('div', { class: 'bar' }, h('i', { class: 'g', style: { width: pct(v, t.total) + '%' } })))),
      t.link_sent && t.not_opened ? h('div', { class: 'callout warn mb0' }, `${fnum(t.not_opened)} Associates ont reçu leur lien mais ne l’ont pas encore ouvert — relancez-les par WhatsApp ou e-mail.`) : null));

  // Par mois
  const maxM = Math.max(1, ...d.by_month.map((m) => m.received + m.not_received));
  root.append(h('div', { class: 'card' }, h('h2', {}, 'Historique mois par mois'),
    d.by_month.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Mois', 'Reçus (confirmés)', 'Pas reçus', 'Corrections', 'Sans preuve', 'Montant déclaré'].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
      h('tbody', {}, d.months.map((mo) => { const m = d.by_month.find((x) => x.month === mo) || { received: 0, confirmed: 0, not_received: 0, disputed: 0, noproof: 0, amount: 0 };
        return h('tr', { style: { cursor: 'default' } }, h('td', {}, h('b', {}, mlabel(mo)), h('div', { class: 'bar', style: { marginTop: '6px', maxWidth: '160px', height: '6px' } }, h('i', { class: 'g', style: { width: pct(m.confirmed, maxM) + '%' } }), h('i', { class: 'g2', style: { width: pct(m.received - m.confirmed, maxM) + '%' } }))),
          h('td', { class: 'num' }, `${fnum(m.received)} `, h('span', { class: 'muted' }, `(${fnum(m.confirmed)})`)), h('td', { class: 'num' }, fnum(m.not_received)), h('td', { class: 'num' }, m.disputed ? badge(m.disputed, 'b-red') : '0'),
          h('td', { class: 'num' }, m.noproof ? badge(m.noproof, 'b-amber') : '0'), h('td', { class: 'num' }, fcfa(m.amount))); })))) : h('div', { class: 'empty' }, 'Aucune déclaration pour le moment.'),
    h('div', { class: 'legend' }, h('span', {}, h('i', { style: { background: 'var(--green)' } }), 'Confirmés par le TC'), h('span', {}, h('i', { style: { background: '#7fc3a6' } }), 'Déclarés, à valider'))));

  if (d.role === 'admin' && d.by_tc.length) root.append(h('div', { class: 'card' }, h('h2', {}, 'Par TC référent'), progressTable(d.by_tc, 'name', (r) => open({ tc: r.id ? String(r.id) : 'none' })())));
  root.append(h('div', { class: 'card' }, h('h2', {}, 'Par entreprise'), progressTable(d.by_employer, 'employer', (r) => open({ employer: r.employer === '(non renseignée)' ? '__none' : r.employer })())));
  return root;
}

function progressTable(rows, key, onRow) {
  return h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, [h('th', {}, key === 'name' ? 'TC' : 'Entreprise'), h('th', { class: 'num' }, 'Associates'), h('th', { style: { minWidth: '160px' } }, 'Réponses signées'), h('th', { class: 'num' }, 'À valider')])),
    h('tbody', {}, rows.map((r) => h('tr', { onclick: () => onRow(r) }, h('td', {}, r[key]), h('td', { class: 'num' }, fnum(r.total)),
      h('td', {}, h('div', { class: 'row gap-s', style: { flexWrap: 'nowrap' } }, h('div', { class: 'bar grow', style: { height: '8px' } }, h('i', { class: 'g', style: { width: pct(r.submitted, r.total) + '%' } })), h('span', { class: 'small mono', style: { minWidth: '40px' } }, pct(r.submitted, r.total) + ' %'))),
      h('td', { class: 'num' }, r.to_review ? badge(r.to_review, 'b-amber') : '0'))))));
}

// ---------------------------------------------------------------- Liste
const STATUS_OPTS = [['', 'Tous les statuts'], ['none', 'Pas encore répondu'], ['draft', 'En cours / à re-signer'], ['submitted', 'Déclaration signée'], ['no_stipend', 'Aucun stipend reçu'], ['toreview', 'À valider'], ['confirmed', 'Tout confirmé'], ['disputed', 'Correction demandée'], ['noproof', 'Preuve manquante'], ['nolink', 'Lien pas encore envoyé'], ['linksent', 'Lien envoyé'], ['notopened', 'Lien envoyé mais pas ouvert'], ['opened', 'Lien ouvert']];

function responseBadge(r) {
  if (r.last_submitted_at && !r.dirty) return r.has_received ? badge('Signé', 'b-green') : badge('Signé · aucun stipend', 'b-grey');
  if (r.dirty) return badge(r.last_submitted_at ? 'À re-signer' : 'En cours', 'b-amber');
  return badge('Pas répondu', 'b-grey');
}

async function associatesView({ go }) {
  const isAdmin = S.user.role === 'admin';
  const Q = S.list.q;
  const sel = new Set();
  const out = h('div');
  const tbody = h('tbody'), pager = h('div', { class: 'pager' }), bulk = h('div');
  let total = 0, rows = [];

  const field = (key, opts, label) => {
    const s = h('select', { class: 'input', 'aria-label': label, onchange: () => { Q[key] = s.value; S.list.offset = 0; load(); } }, opts.map(([v, l]) => h('option', { value: v, selected: (Q[key] || '') === v }, l)));
    return s;
  };
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Rechercher : nom, e-mail, téléphone, réf…', value: Q.search || '', 'aria-label': 'Recherche', oninput: debounce(() => { Q.search = search.value; S.list.offset = 0; load(); }, 350) });
  const months = (S.stats?.months || []);
  const f = S.filters;
  const filters = h('div', { class: 'filters' }, search,
    field('status', STATUS_OPTS, 'Statut'),
    field('employer', [['', 'Toutes les entreprises'], ['__none', '(non renseignée)'], ...f.employers.map((e) => [e.employer, `${e.employer} (${e.n})`])], 'Entreprise'),
    isAdmin ? field('tc', [['', 'Tous les TC'], ['none', 'Sans TC'], ...f.tcs.map((x) => [String(x.id), x.name])], 'TC') : null,
    field('country', [['', 'Tous les pays'], ...f.countries.map((c) => [c.country, `${c.country} (${c.n})`])], 'Pays'),
    months.length ? field('missing', [['', 'Mois non renseigné…'], ...months.map((m) => [m, `Manque ${mlabel(m)}`])], 'Mois manquant') : null);

  const qs = (extra = {}) => new URLSearchParams({ ...Object.fromEntries(Object.entries(Q).filter(([, v]) => v)), ...extra }).toString();
  const exportMenu = h('div', { class: 'row gap-s' },
    h('a', { class: 'btn sm', href: `/api/associates?${qs({ format: 'csv' })}`, download: '' }, icon('download', 16), 'Export synthèse (CSV)'),
    h('a', { class: 'btn sm', href: `/api/associates?${qs({ format: 'csv', layout: 'long' })}`, download: '' }, icon('download', 16), 'Export historique (CSV)'),
    h('button', { class: 'btn sm primary', onclick: confirmAll }, icon('check', 16), 'Tout confirmer (avec preuve)'));

  async function confirmAll() {
    const close = modal(h('div', {}, h('h2', {}, 'Confirmer les déclarations ?'), h('p', {}, 'Toutes les déclarations en attente qui comportent un montant ET un justificatif seront confirmées. Les autres restent à valider individuellement.'),
      h('div', { class: 'row mt', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onclick: () => close() }, 'Annuler'), h('button', { class: 'btn primary', onclick: async () => {
        try { const r = await api('/api/review-bulk', { method: 'POST', body: { mode: 'all_pending_with_proof' } }); close(); toast(`${r.confirmed} mois confirmé(s) ✓`, 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
      } }, 'Confirmer'))));
  }

  async function load() {
    tbody.replaceChildren(h('tr', {}, h('td', { colspan: 9 }, spinner())));
    try {
      const r = await api(`/api/associates?${qs({ limit: 50, offset: S.list.offset })}`);
      total = r.total; rows = r.items; paint();
    } catch (e) { tbody.replaceChildren(h('tr', {}, h('td', { colspan: 9 }, h('div', { class: 'callout bad' }, e.message)))); }
  }

  function paint() {
    const all = h('input', { type: 'checkbox', 'aria-label': 'Tout sélectionner sur cette page', checked: rows.length && rows.every((r) => sel.has(r.id)), onclick: (e) => { e.stopPropagation(); rows.forEach((r) => (e.target.checked ? sel.add(r.id) : sel.delete(r.id))); paint(); } });
    thead.replaceChildren(h('tr', {}, [isAdmin ? h('th', {}, all) : null, ...['Réf', 'Associate', 'Entreprise', 'TC', 'Réponse'].map((x) => h('th', {}, x)), ...['Mois reçus', 'Total (FCFA)'].map((x) => h('th', { class: 'num' }, x)), h('th', {}, 'Suivi')]));
    tbody.replaceChildren(...(rows.length ? rows.map((r) => h('tr', { tabindex: 0, onclick: () => openDrawer(r.id, load), onkeydown: (e) => e.key === 'Enter' && openDrawer(r.id, load) },
      isAdmin ? h('td', { onclick: (e) => e.stopPropagation() }, h('input', { type: 'checkbox', checked: sel.has(r.id), 'aria-label': `Sélectionner ${r.full_name}`, onchange: (e) => { e.target.checked ? sel.add(r.id) : sel.delete(r.id); paintBulk(); } })) : null,
      h('td', { class: 'mono small' }, r.ref), h('td', {}, h('b', {}, r.full_name), h('div', { class: 'small muted' }, r.email || '')), h('td', { class: 'small' }, r.employer || h('span', { class: 'muted' }, '—')),
      h('td', { class: 'small' }, r.tc_name || (r.declared_tc ? h('span', { class: 'muted' }, `${r.declared_tc} (déclaré)`) : h('span', { class: 'muted' }, '—'))), h('td', {}, responseBadge(r)),
      h('td', { class: 'num' }, r.n_received ? `${r.n_received} ` : '0', r.n_received ? h('span', { class: 'muted small' }, `(${r.n_confirmed} ✓)`) : null), h('td', { class: 'num' }, r.total ? fnum(r.total) : '—'),
      h('td', {}, h('div', { class: 'row gap-s' }, r.n_pending ? badge(`${r.n_pending} à valider`, 'b-amber') : null, r.n_disputed ? badge(`${r.n_disputed} correction`, 'b-red') : null, r.n_noproof ? badge(`${r.n_noproof} sans preuve`, 'b-grey') : null))))
      : [h('tr', {}, h('td', { colspan: 9 }, h('div', { class: 'empty' }, 'Aucun Associate ne correspond à ces critères.')))]));
    const from = total ? S.list.offset + 1 : 0, to = Math.min(total, S.list.offset + 50);
    pager.replaceChildren(h('span', { class: 'muted small' }, `${fnum(from)}–${fnum(to)} sur ${fnum(total)}`), h('div', { class: 'row gap-s' },
      h('button', { class: 'btn sm', disabled: S.list.offset === 0, onclick: () => { S.list.offset = Math.max(0, S.list.offset - 50); load(); } }, '← Précédent'),
      h('button', { class: 'btn sm', disabled: to >= total, onclick: () => { S.list.offset += 50; load(); } }, 'Suivant →')));
    paintBulk();
  }

  function paintBulk() {
    if (!isAdmin || !sel.size) return bulk.replaceChildren();
    bulk.replaceChildren(h('div', { class: 'bulk' }, h('b', {}, `${sel.size} sélectionné(s)`),
      h('button', { class: 'btn sm', onclick: selectAllResults }, `Tout sélectionner (${fnum(total)})`),
      h('button', { class: 'btn sm', onclick: () => assignModal([...sel], load) }, icon('users', 16), 'Assigner à un TC'),
      h('button', { class: 'btn sm', onclick: () => sendModal([...sel]) }, icon('mail', 16), 'Envoyer le lien'),
      h('button', { class: 'btn sm ghost', style: { color: '#fff' }, onclick: () => { sel.clear(); paint(); } }, 'Annuler')));
  }
  async function selectAllResults() {
    for (let off = 0; off < total; off += 200) { const r = await api(`/api/associates?${qs({ limit: 200, offset: off })}`); r.items.forEach((i) => sel.add(i.id)); }
    paint(); toast(`${sel.size} sélectionnés`);
  }

  const thead = h('thead');
  out.append(h('div', { class: 'row between', style: { marginBottom: '12px' } }, h('h2', { class: 'mb0' }, S.user.role === 'tc' ? 'Mes Associates' : 'Associates'), exportMenu), filters, h('div', { class: 'tablewrap' }, h('table', {}, thead, tbody)), pager, bulk);
  load();
  return out;
}

export function assignModal(ids, done, preset = {}) {
  const tcs = S.filters.tcs;
  const select = h('select', { class: 'input' }, h('option', { value: '' }, '— Retirer le TC —'), tcs.map((t) => h('option', { value: t.id }, `${t.name} (${t.email})`)));
  const close = modal(h('div', {}, h('h2', {}, ids ? `Assigner ${ids.length} Associate(s)` : `Assigner l’entreprise « ${preset.employer} »`),
    tcs.length ? h('div', {}, h('label', { class: 'f' }, 'TalentCorps (TC) référent'), select,
      !ids ? h('label', { class: 'chk mt-s' }, h('input', { type: 'checkbox', id: 'onlyfree', checked: true }), h('span', {}, 'Uniquement ceux qui n’ont pas encore de TC')) : null)
      : h('div', { class: 'callout warn' }, 'Aucun TC enregistré. Ajoutez-les dans l’onglet Équipe.'),
    h('div', { class: 'row mt', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onclick: () => close() }, 'Annuler'), h('button', { class: 'btn primary', disabled: !tcs.length, onclick: async () => {
      try {
        const body = { tc_id: select.value ? Number(select.value) : null, ...(ids ? { ids } : { employer: preset.employer, only_unassigned: document.getElementById('onlyfree')?.checked }) };
        const r = await api('/api/associates/assign', { method: 'POST', body }); close(); toast(`${r.updated} Associate(s) assigné(s) ✓`, 'ok'); done?.();
      } catch (e) { toast(e.message, 'err'); }
    } }, 'Assigner'))));
}

export function sendModal(ids) {
  const close = modal(h('div', {}, h('h2', {}, `Envoyer à ${ids.length} Associate(s)`), h('p', { class: 'muted' }, 'Chaque personne reçoit un e-mail avec son lien personnel.'),
    h('div', { class: 'row mt', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onclick: () => close() }, 'Annuler'),
      ['invite', 'reminder'].map((kind) => h('button', { class: 'btn' + (kind === 'invite' ? ' primary' : ''), onclick: async () => {
        try { const r = await api('/api/invite', { method: 'POST', body: { kind, target: 'ids', ids } }); close(); toast(r.mail_configured ? `${r.queued} e-mail(s) en cours d’envoi ✓` : `${r.queued} e-mail(s) en file (envoi non configuré)`, r.mail_configured ? 'ok' : ''); } catch (e) { toast(e.message, 'err'); }
      } }, kind === 'invite' ? 'Invitation' : 'Rappel')))));
}

// ---------------------------------------------------------------- Fiche Associate
export async function openDrawer(id, onChange) {
  const bg = h('div', { class: 'drawer-bg' }), panel = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Fiche Associate' });
  const close = () => { bg.remove(); panel.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => e.key === 'Escape' && !document.querySelector('.modal-bg') && close();
  bg.onclick = close; document.addEventListener('keydown', esc);
  document.body.append(bg, panel);
  const isAdmin = S.user.role === 'admin';
  async function load() {
    panel.replaceChildren(h('div', { class: 'db' }, spinner()));
    let D;
    try { D = await api(`/api/associates/${id}`); } catch (e) { panel.replaceChildren(h('div', { class: 'db' }, h('div', { class: 'callout bad' }, e.message))); return; }
    const A = D.associate;
    const refresh = async () => { await load(); onChange?.(); };
    const kv = (l, v) => h('div', { class: 'kv' }, h('b', {}, l), h('span', {}, v || '—'));
    const link = A.token ? `${location.origin}/a/${A.token}` : null;
    const hasConfirmed = D.months.some((m) => m.review === 'confirmed' && m.declared === 'received');

    const tcSel = isAdmin ? h('select', { class: 'input', 'aria-label': 'TC référent', onchange: async () => { try { await api(`/api/associates/${A.id}`, { method: 'PATCH', body: { tc_id: tcSel.value ? Number(tcSel.value) : null } }); toast('TC mis à jour ✓', 'ok'); onChange?.(); } catch (e) { toast(e.message, 'err'); } } },
      h('option', { value: '' }, '— Aucun —'), S.filters.tcs.map((t) => h('option', { value: t.id, selected: t.id === A.tc_id }, t.name))) : null;

    const monthBlock = (m) => {
      const rv = REVIEW[m.review];
      const proof = m.proof ? (m.proof.mime.startsWith('image/')
        ? h('a', { href: `/api/proof/${m.proof.id}`, target: '_blank', rel: 'noopener' }, h('img', { class: 'imgprev', src: `/api/proof/${m.proof.id}`, alt: `Justificatif ${m.label}`, loading: 'lazy' }))
        : h('a', { class: 'btn sm mt-s', href: `/api/proof/${m.proof.id}`, target: '_blank', rel: 'noopener' }, icon('file', 16), `Ouvrir le PDF (${m.proof.name})`)) : (m.ext_proof_url ? h('a', { class: 'btn sm mt-s', href: m.ext_proof_url, target: '_blank', rel: 'noopener' }, icon('link', 16), 'Preuve (lien Google Drive du formulaire)') : h('div', { class: 'callout warn mt-s mb0' }, 'Aucune preuve jointe.'));
      const review = async (status, comment) => { try { await api(`/api/associates/${A.id}/review`, { method: 'POST', body: { month: m.month, status, comment } }); toast(status === 'confirmed' ? 'Confirmé ✓' : status === 'disputed' ? 'Correction demandée' : 'Décision annulée', 'ok'); refresh(); } catch (e) { toast(e.message, 'err'); } };
      const dispute = () => { const ta = h('textarea', { class: 'input', placeholder: 'Ex. Le montant ne correspond pas au justificatif…', maxlength: 500 }); const c = modal(h('div', {}, h('h2', {}, `Demander une correction · ${m.label}`), h('label', { class: 'f' }, 'Motif (envoyé à l’Associate) *'), ta,
        h('div', { class: 'row mt', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onclick: () => c() }, 'Annuler'), h('button', { class: 'btn danger', onclick: () => { if (ta.value.trim().length < 3) return ta.focus(); c(); review('disputed', ta.value); } }, 'Envoyer')))); };
      return h('div', { class: 'mrow' }, h('div', { class: 'top' }, h('b', {}, m.label), m.declared === 'received' ? badge(rv[0], rv[1]) : badge('Pas encore reçu', 'b-grey')),
        m.declared === 'received' ? h('div', {}, h('div', { class: 'mt-s' }, h('b', { class: 'mono' }, fcfa(m.amount)), h('span', { class: 'muted' }, ` · reçu le ${fdate(m.received_date)}`)), proof,
          m.review_comment ? h('div', { class: 'callout bad mt-s mb0' }, `Motif : ${m.review_comment}`) : null,
          m.sent_amount ? h('div', { class: 'small muted mt-s' }, `Virement : ${fcfa(m.sent_amount)} le ${fdate(m.sent_date)} `, m.sent_proof ? h('a', { href: `/api/proof/${m.sent_proof}`, target: '_blank', rel: 'noopener' }, '(preuve)') : '(sans preuve)') : null,
          h('div', { class: 'row gap-s mt-s' }, m.review !== 'confirmed' ? h('button', { class: 'btn sm primary', onclick: () => review('confirmed') }, icon('check', 16), 'Confirmer') : null,
            m.review !== 'disputed' ? h('button', { class: 'btn sm danger', onclick: dispute }, 'Demander une correction') : null,
            m.review !== 'pending' ? h('button', { class: 'btn sm', onclick: () => review('pending') }, 'Annuler la décision') : null)) : null);
    };

    panel.replaceChildren(
      h('div', { class: 'dh' }, h('div', {}, h('h2', { class: 'mb0' }, A.full_name), h('span', { class: 'small muted mono' }, `${A.ref} · ${A.id.replace(/-/g, '').toLowerCase()}TA`)), h('button', { class: 'btn sm', onclick: close, 'aria-label': 'Fermer' }, icon('x', 16))),
      h('div', { class: 'db' },
        h('div', { class: 'card' }, h('h3', {}, 'Informations'), kv('E-mail', A.email), kv('Téléphone', A.phone), kv('Pays', A.country), kv('Entreprise', A.employer),
          h('div', { class: 'kv' }, h('b', {}, 'TC référent'), tcSel || h('span', {}, A.tc_name || (A.declared_tc ? `${A.declared_tc} (déclaré par l’Associate)` : '—'))),
          isAdmin && A.declared_tc && A.tc_name !== A.declared_tc ? h('div', { class: 'small muted' }, `TC déclaré par l’Associate : ${A.declared_tc}`) : null,
          kv('Profil CFA', [({ F: 'Femme', M: 'Homme' }[A.gender] || 'Genre ?'), ({ refugee: 'Réfugié', idp: 'Déplacé interne', both: 'Réfugié + déplacé', rdp: 'R/DP' }[A.rdp]) || null, ({ scholar: 'Alumni (Scholar MCF)', other: 'Alumni (autre programme MCF)' }[A.mcf]) || 'Non alumni', A.area === 'rural' ? 'Rural' : A.area === 'urban' ? 'Urbain' : null].filter(Boolean).join(' · ')),
          kv('Placement (CFA)', `${A.placement_start ? fdate(A.placement_start) : '—'}${A.employer_kpmg_id ? ' · ' + A.employer_kpmg_id : ''}`),
          isAdmin ? h('div', { class: 'kv' }, h('b', {}, 'PWD'), h('label', { class: 'row gap-s' }, h('input', { type: 'checkbox', checked: !!A.pwd, onchange: async (e) => { try { await api(`/api/associates/${A.id}`, { method: 'PATCH', body: { pwd: e.target.checked } }); toast('Mis à jour ✓', 'ok'); onChange?.(); } catch (er) { toast(er.message, 'err'); e.target.checked = !e.target.checked; } } }), 'Personne en situation de handicap')) : null,
          isAdmin ? h('div', { class: 'kv' }, h('b', {}, 'Démarrage du stage'), h('input', { class: 'input', type: 'date', value: A.start_date || '', 'aria-label': 'Date de démarrage du stage', style: { maxWidth: '170px' }, onchange: async (e) => { try { await api(`/api/associates/${A.id}`, { method: 'PATCH', body: { start_date: e.target.value || null } }); A.start_date = e.target.value || null; toast('Date mise à jour ✓', 'ok'); onChange?.(); } catch (er) { toast(er.message, 'err'); e.target.value = A.start_date || ''; } } })) : kv('Démarrage du stage', fdate(A.start_date)), kv('Dernière signature', A.last_submitted_at ? fdt(A.last_submitted_at) : 'Jamais'), kv('Dernière ouverture du lien', fdt(A.last_opened_at))),
        isAdmin && link ? h('div', { class: 'card' }, h('h3', {}, 'Lien personnel'), h('div', { class: 'small muted', style: { marginBottom: '8px' } }, A.link_sent_at ? `Envoyé le ${fdt(A.link_sent_at)} (${A.link_channel || '—'}) · ${A.last_opened_at ? 'ouvert le ' + fdt(A.last_opened_at) : 'pas encore ouvert'}` : 'Pas encore envoyé'), h('div', { class: 'row gap-s' },
          h('button', { class: 'btn sm', onclick: () => copy(link) }, icon('link', 16), 'Copier'),
          A.phone ? h('a', { class: 'btn sm', onclick: () => api('/api/links/mark-sent', { method: 'POST', body: { ids: [A.id], channel: 'whatsapp' } }).then(() => { A.link_sent_at = new Date().toISOString(); }).catch(() => {}), target: '_blank', rel: 'noopener', href: `https://wa.me/${A.phone}?text=${encodeURIComponent(`Bonjour ${A.full_name}, merci de renseigner la réception de vos stipends (2 min) : ${link}`)}` }, 'WhatsApp') : null,
          h('button', { class: 'btn sm', onclick: () => sendModal([A.id]) }, icon('mail', 16), 'Envoyer par e-mail'),
          h('button', { class: 'btn sm danger', onclick: async () => { if (!confirm('Régénérer le lien ? L’ancien lien cessera de fonctionner.')) return; try { await api(`/api/associates/${A.id}/regen-link`, { method: 'POST' }); toast('Nouveau lien généré', 'ok'); refresh(); } catch (e) { toast(e.message, 'err'); } } }, icon('refresh', 16), 'Régénérer'))) : null,
        h('h3', { class: 'mt' }, 'Stipends déclarés'),
        D.months.filter((m) => m.declared).length ? D.months.filter((m) => m.declared).map(monthBlock) : h('div', { class: 'empty card' }, 'Aucune déclaration pour l’instant.'),
        hasConfirmed ? h('button', { class: 'btn primary mt-s', onclick: async (e) => { e.currentTarget.disabled = true; try { const p = await api(`/api/associates/${A.id}/attestation`, { method: 'POST' }); downloadBlob(await buildAttestation(p), `attestation-${A.ref}-${p.code}.pdf`); toast('Attestation générée ✓', 'ok'); refresh(); } catch (er) { toast(er.message, 'err'); } e.currentTarget.disabled = false; } }, icon('download'), 'Générer l’attestation PDF') : null,
        D.attestations.length ? h('p', { class: 'small muted mt-s' }, 'Attestations émises : ', D.attestations.map((a) => `${a.code} (${fdate(a.issued_at)})`).join(' · ')) : null,
        D.declarations.length ? h('div', { class: 'card mt' }, h('h3', {}, 'Signatures'), D.declarations.map((d) => h('div', { class: 'kv' }, h('div', { class: 'row between' }, h('span', {}, `Signé le ${fdt(d.signed_at)}`), h('span', { class: 'small muted' }, d.ip || '')),
          h('img', { src: `/api/declarations/${d.id}/signature`, alt: 'Signature', style: { maxHeight: '60px', maxWidth: '220px' } })))) : null,
        h('div', { class: 'card mt' }, h('h3', {}, 'Historique complet'), D.events.length ? h('ul', { class: 'timeline' }, D.events.map((e) => h('li', {}, h('span', { class: 'dot' }), h('div', {}, h('b', {}, EVENT_LABELS[e.type] || e.type), e.month ? ` · ${mlabel(e.month)}` : '', e.data?.amount ? ` · ${fcfa(e.data.amount)}` : '', e.data?.comment ? ` — ${e.data.comment}` : '',
          h('div', { class: 'small muted' }, `${fdt(e.created_at)} · ${e.actor === 'associate' ? 'Associate' : e.actor.replace('staff:', '')}`))))) : h('p', { class: 'muted' }, 'Aucun événement.'))));
  }
  load();
}
