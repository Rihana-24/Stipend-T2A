import { h, api, fcfa, fnum, pct, toast, modal, badge, spinner, mlabel, todayStr } from './lib.js';

const FUND = { full: ['Full stipend', 'b-blue'], shared: ['Shared stipend', 'b-green'] };
const csvDownload = (name, rows) => {
  const cell = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' })), download: name });
  document.body.append(a); a.click(); a.remove();
};
const monthsUpToNow = () => { const out = []; const now = new Date(); let y = 2026, m = 6; while (y < now.getUTCFullYear() || (y === now.getUTCFullYear() && m <= now.getUTCMonth() + 1)) { out.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } } return out; };
const bar = (v, max, cls = 'g') => h('div', { class: 'bar' }, h('i', { class: cls, style: { width: Math.min(100, pct(v, max)) + '%' } }));
const kpi = (v, label, cls = '') => h('div', { class: 'kpi ' + cls }, h('b', {}, v), h('span', {}, label));

export async function placementsView({ go, S }) {
  const d = await api('/api/placements');
  const isAdmin = d.role === 'admin';
  const t = d.totals;
  const root = h('div', {});

  root.append(h('div', { class: 'kpis' },
    kpi(isAdmin ? `${fnum(t.placed_groups)} / ${fnum(t.target)}` : fnum(t.placed), isAdmin ? 'Placements / objectif' : 'Associates placés', 'good'),
    kpi(fnum(t.validated), 'Associates validés'), kpi(fnum(t.remaining), 'Restants à valider', t.remaining ? 'warn' : ''),
    kpi(`${fnum(t.n_full)} / ${fnum(t.n_shared)}`, 'Full / Shared stipend'), kpi(fnum(t.pwd), 'PWD'),
    kpi(fnum(t.sent), 'Montant viré (FCFA)'), kpi(fnum(t.received), 'Montant reçu déclaré (FCFA)', t.sent > t.received ? 'warn' : 'good')));
  if (t.n_undef) root.append(h('div', { class: 'callout warn' }, `${fnum(t.n_undef)} Associates sont rattachés à une entreprise dont le type de financement (full / shared) n’est pas encore défini.`));


  // ---- Profil des placés (genre, R/DP, PWD, alumni)
  const P = d.profile, pt = P.total;
  const pcell = (v, n) => h('td', { class: 'num' }, `${fnum(v)}`, h('span', { class: 'small muted' }, ` (${pct(v, n)} %)`));
  const nonAl = (o) => o.profiled - o.alumni;
  root.append(h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h2', { class: 'mb0' }, 'Profil des placés'),
    h('button', { class: 'btn sm', onclick: () => csvDownload(`profil-places-${todayStr()}.csv`, [['Zone', 'Placés', 'Femmes', 'Hommes', 'Réfugiés ou déplacés (R/DP)', 'dont réfugiés', 'dont déplacés internes', 'PWD', 'Alumni MCF', 'dont Scholars', 'Non alumni', 'Rural'],
      ...[...P.groups.map((g) => [g.label, g.n, g.women, g.men, g.rdp, g.refugees, g.idp, g.pwd, g.alumni, g.scholars, nonAl(g), g.rural]), ['Total', pt.n, pt.women, pt.men, pt.rdp, pt.refugees, pt.idp, pt.pwd, pt.alumni, pt.scholars, nonAl(pt), pt.rural]]]) }, 'Exporter CSV')),
    pt.profiled < pt.n ? h('div', { class: 'callout warn' }, `${fnum(pt.n - pt.profiled)} Associates n’ont pas encore de profil CFA (genre, alumni…). Lancez « npm run db:cfa » après l’import.`) : null,
    h('div', { class: 'kpis' }, kpi(fnum(pt.women), `Femmes (${pct(pt.women, pt.n)} %)`), kpi(fnum(pt.men), `Hommes (${pct(pt.men, pt.n)} %)`), kpi(fnum(pt.rdp), `Réfugiés / déplacés (${fnum(pt.refugees)} réf. · ${fnum(pt.idp)} dép.)`),
      kpi(fnum(pt.pwd), 'PWD'), kpi(fnum(nonAl(pt)), `Non alumni (${fnum(pt.alumni)} alumni)`)),
    h('div', { class: 'tablewrap mt-s' }, h('table', {}, h('thead', {}, h('tr', {}, ['Zone', 'Placés', 'Femmes', 'Hommes', 'R/DP', 'PWD', 'Alumni', 'Non alumni', 'Rural'].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
      h('tbody', {}, P.groups.map((g) => h('tr', { style: { cursor: 'default' } }, h('td', {}, h('b', {}, g.label)), h('td', { class: 'num' }, fnum(g.n)), pcell(g.women, g.n), pcell(g.men, g.n), h('td', { class: 'num' }, fnum(g.rdp)), h('td', { class: 'num' }, fnum(g.pwd)), h('td', { class: 'num' }, fnum(g.alumni)), h('td', { class: 'num' }, fnum(nonAl(g))), h('td', { class: 'num' }, fnum(g.rural)))))))));

  // ---- Objectifs par pays (admin)
  if (isAdmin) {
    const edit = () => {
      const tg = {}, pf = {};
      const rows = d.groups.map((g) => h('tr', { style: { cursor: 'default' } }, h('td', {}, g.label),
        h('td', {}, h('input', { class: 'input', type: 'number', min: 0, value: g.target, oninput: (e) => (tg[g.key] = e.target.value), style: { width: '110px' } })),
        h('td', {}, h('input', { class: 'input', type: 'number', min: 0, value: g.placed_file ?? '', oninput: (e) => (pf[g.key] = e.target.value), style: { width: '110px' } }))));
      d.groups.forEach((g) => { tg[g.key] = g.target; pf[g.key] = g.placed_file ?? ''; });
      const c = modal(h('div', {}, h('h2', {}, 'Objectifs et placements officiels'),
        h('p', { class: 'muted small' }, '« Placés (suivi employeurs) » = chiffre du fichier de suivi des besoins. L’outil retient le plus élevé entre ce chiffre et les Associates réellement présents dans l’outil.'),
        h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Groupe de pays', 'Objectif', 'Placés (suivi employeurs)'].map((x) => h('th', {}, x)))), h('tbody', {}, rows))),
        h('div', { class: 'row mt', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onclick: () => c() }, 'Annuler'),
          h('button', { class: 'btn primary', onclick: async () => { try { await api('/api/placements/targets', { method: 'PUT', body: { targets: tg, placed: pf } }); c(); toast('Enregistré ✓', 'ok'); go('place'); } catch (e) { toast(e.message, 'err'); } } }, 'Enregistrer'))));
    };
    root.append(h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h2', { class: 'mb0' }, 'Placements par zone — objectif 1 800'), h('button', { class: 'btn sm', onclick: edit }, 'Modifier les objectifs')),
      h('div', { class: 'tablewrap mt-s' }, h('table', {}, h('thead', {}, h('tr', {}, [h('th', {}, 'Zone'), h('th', { class: 'num' }, 'Objectif'), h('th', { class: 'num' }, 'Placés'), h('th', { class: 'num' }, 'Dans l’outil'), h('th', { class: 'num' }, 'Restants'), h('th', { class: 'num' }, 'PWD'), h('th', { style: { minWidth: '140px' } }, 'Avancement')])),
        h('tbody', {}, d.groups.map((g) => h('tr', { style: { cursor: 'default' } }, h('td', {}, h('b', {}, g.label)), h('td', { class: 'num' }, fnum(g.target)), h('td', { class: 'num' }, fnum(g.placed)), h('td', { class: 'num' }, fnum(g.in_tool)),
          h('td', { class: 'num' }, g.remaining ? badge(fnum(g.remaining), 'b-amber') : badge('0', 'b-green')), h('td', { class: 'num' }, fnum(g.pwd)), h('td', {}, bar(g.placed, g.target || 1), h('span', { class: 'small muted' }, pct(g.placed, g.target) + ' %')))),
          h('tr', { style: { cursor: 'default', fontWeight: 700 } }, h('td', {}, 'Total'), h('td', { class: 'num' }, fnum(t.target)), h('td', { class: 'num' }, fnum(t.placed_groups)), h('td', { class: 'num' }, fnum(d.groups.reduce((a, g) => a + g.in_tool, 0))),
            h('td', { class: 'num' }, fnum(Math.max(0, t.target - t.placed_groups))), h('td', { class: 'num' }, fnum(d.groups.reduce((a, g) => a + g.pwd, 0))), h('td', {}, pct(t.placed_groups, t.target) + ' %')))))));
  }

  // ---- Tableau par TC (ordre alphabétique)
  const head = ['TalentCorps (TC)', 'Placés', 'Validés', 'Restants', 'Full', 'Shared', 'PWD', 'Montant viré', 'Montant reçu', 'Preuves virement', 'Preuves réception'];
  root.append(h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h2', { class: 'mb0' }, isAdmin ? 'Suivi par TalentCorps' : 'Mon suivi'),
    h('button', { class: 'btn sm', onclick: () => csvDownload(`suivi-tc-${todayStr()}.csv`, [['TC', 'Placés', 'Validés', 'Restants', 'Full stipend', 'Shared stipend', 'Financement à définir', 'Femmes', 'Hommes', 'R/DP', 'Non alumni', 'PWD', 'Montant viré (FCFA)', 'Montant reçu (FCFA)', 'Virements avec preuve', 'Virements', 'Réceptions avec preuve', 'Réceptions'],
      ...d.rows.map((r) => [r.tc, r.placed, r.validated, r.remaining, r.n_full, r.n_shared, r.n_undef, r.women, r.men, r.rdp, r.non_alumni, r.pwd, r.sent, r.received, r.sent_proofs, r.n_sent, r.recv_proofs, r.n_recv])]) }, 'Exporter CSV')),
    h('p', { class: 'muted small' }, 'Validés = Associates dont tous les stipends déclarés sont confirmés par le TC. Restants = placés − validés.'),
    h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, head.map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
      h('tbody', {}, d.rows.map((r) => h('tr', { style: { cursor: 'default' } }, h('td', {}, h('b', {}, r.tc)), h('td', { class: 'num' }, fnum(r.placed)), h('td', { class: 'num' }, fnum(r.validated)),
        h('td', { class: 'num' }, r.remaining ? badge(fnum(r.remaining), 'b-amber') : '0'), h('td', { class: 'num' }, fnum(r.n_full)), h('td', { class: 'num' }, fnum(r.n_shared) + (r.n_undef ? ` (+${r.n_undef} à définir)` : '')), h('td', { class: 'num' }, fnum(r.pwd)),
        h('td', { class: 'num' }, fcfa(r.sent)), h('td', { class: 'num' }, fcfa(r.received)),
        h('td', { class: 'num' }, r.n_sent ? `${r.sent_proofs} / ${r.n_sent}` : '—'), h('td', { class: 'num' }, r.n_recv ? `${r.recv_proofs} / ${r.n_recv}` : '—'))),
        h('tr', { style: { cursor: 'default', fontWeight: 700 } }, h('td', {}, 'Total'), h('td', { class: 'num' }, fnum(t.placed)), h('td', { class: 'num' }, fnum(t.validated)), h('td', { class: 'num' }, fnum(t.remaining)), h('td', { class: 'num' }, fnum(t.n_full)), h('td', { class: 'num' }, fnum(t.n_shared)),
          h('td', { class: 'num' }, fnum(t.pwd)), h('td', { class: 'num' }, fcfa(t.sent)), h('td', { class: 'num' }, fcfa(t.received)), h('td', { class: 'num' }, t.n_sent ? `${t.sent_proofs} / ${t.n_sent}` : '—'), h('td', { class: 'num' }, t.n_recv ? `${t.recv_proofs} / ${t.n_recv}` : '—')))))));
  if (!isAdmin) return root;

  // ---- Financement par entreprise
  const dirty = new Map();
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Rechercher une entreprise…', 'aria-label': 'Rechercher une entreprise' });
  const tb = h('tbody');
  const paint = () => {
    const f = q.value.trim().toLowerCase();
    tb.replaceChildren(...d.employers.filter((e) => !f || e.name.toLowerCase().includes(f)).map((e) => {
      const mark = () => { dirty.set(e.name, e); save.disabled = false; save.textContent = `Enregistrer (${dirty.size})`; };
      return h('tr', { style: { cursor: 'default' } }, h('td', {}, e.name), h('td', { class: 'num' }, fnum(e.n)), h('td', { class: 'num' }, e.quota ?? '—'),
        h('td', {}, h('select', { class: 'input', 'aria-label': 'Financement ' + e.name, onchange: (ev) => { e.funding = ev.target.value || null; mark(); } },
          h('option', { value: '' }, '— à définir —'), h('option', { value: 'full', selected: e.funding === 'full' }, 'Full stipend'), h('option', { value: 'shared', selected: e.funding === 'shared' }, 'Shared (50 / 50)'))),
        h('td', {}, h('input', { class: 'input', type: 'number', value: e.rate, min: 1000, step: 500, style: { width: '110px' }, 'aria-label': 'Stipend mensuel ' + e.name, oninput: (ev) => { e.rate = Number(ev.target.value); mark(); } })));
    }));
  };
  const save = h('button', { class: 'btn primary', disabled: true, onclick: async () => {
    try { const r = await api('/api/employers', { method: 'PUT', body: { items: [...dirty.values()] } }); toast(`${r.updated} entreprise(s) enregistrée(s) ✓`, 'ok'); go('place'); } catch (e) { toast(e.message, 'err'); } } }, 'Enregistrer');
  const setAll = (funding) => () => { const f = q.value.trim().toLowerCase(); d.employers.filter((e) => !f || e.name.toLowerCase().includes(f)).forEach((e) => { e.funding = funding; dirty.set(e.name, e); }); save.disabled = false; save.textContent = `Enregistrer (${dirty.size})`; paint(); };
  q.oninput = paint; paint();
  root.append(h('div', { class: 'card' }, h('h2', {}, 'Type de financement par entreprise'),
    h('p', { class: 'muted small' }, `Full : la Fondation paie le stipend complet (${fcfa(d.default_rate)} par mois). Shared : l’employeur paie 50 %, la Fondation 50 %. CJES Nova Togo et CEMP : 125 000 FCFA selon l’accord signé. Modifiez le montant au besoin.`),
    h('div', { class: 'filters' }, q, h('button', { class: 'btn sm', onclick: setAll('full') }, 'Afficher tout en Full'), h('button', { class: 'btn sm', onclick: setAll('shared') }, 'Afficher tout en Shared'), save),
    h('div', { class: 'tablewrap mt-s', style: { maxHeight: '460px', overflow: 'auto' } }, h('table', {}, h('thead', {}, h('tr', {}, [h('th', {}, 'Entreprise'), h('th', { class: 'num' }, 'Associates'), h('th', { class: 'num' }, 'Quota'), h('th', {}, 'Financement'), h('th', {}, 'Stipend / mois (FCFA)')])), tb))));

  // ---- Virements
  const months = monthsUpToNow();
  const target = h('select', { class: 'input', 'aria-label': 'Entreprise' }, h('option', { value: '' }, '— Toutes les entreprises —'), d.employers.filter((e) => e.n).map((e) => h('option', { value: e.name }, `${e.name} (${e.n})`)));
  const tcSel = h('select', { class: 'input', 'aria-label': 'TC' }, h('option', { value: '' }, '— Tous les TC —'), (S.filters?.tcs || []).map((x) => h('option', { value: x.id }, x.name)));
  const month = h('select', { class: 'input', 'aria-label': 'Mois' }, months.map((m) => h('option', { value: m, selected: m === months[months.length - 1] }, mlabel(m))));
  const date = h('input', { class: 'input', type: 'date', value: todayStr(), 'aria-label': 'Date du virement' });
  const amount = h('input', { class: 'input', type: 'number', min: 1000, step: 500, value: d.default_rate, 'aria-label': 'Montant par Associate' });
  const file = h('input', { class: 'input', type: 'file', accept: 'image/*,application/pdf', 'aria-label': 'Preuve de virement' });
  target.onchange = () => { const e = d.employers.find((x) => x.name === target.value); if (e) amount.value = e.rate; };
  const hist = h('div', {}, spinner());
  const loadHist = async () => {
    const { items } = await api('/api/transfers');
    hist.replaceChildren(items.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Mois', 'Entreprise', 'Associates', 'Viré', 'Date', 'Reçu (déclaré)', 'Preuve'].map((x, i) => h('th', { class: i === 2 || i === 3 || i === 5 ? 'num' : '' }, x)))),
      h('tbody', {}, items.map((x) => h('tr', { style: { cursor: 'default' } }, h('td', {}, mlabel(x.month)), h('td', {}, x.employer), h('td', { class: 'num' }, x.n), h('td', { class: 'num' }, fcfa(x.sent)), h('td', {}, x.sent_date || '—'),
        h('td', { class: 'num' }, x.n_received ? `${fcfa(x.received)} (${x.n_received}/${x.n})` : '—'),
        h('td', {}, x.proof_id ? h('a', { class: 'btn sm', href: `/api/proof/${x.proof_id}`, target: '_blank', rel: 'noopener' }, 'Voir') : badge('Aucune', 'b-grey'))))))) : h('div', { class: 'empty' }, 'Aucun virement enregistré pour le moment.'));
  };
  const send = h('button', { class: 'btn primary', onclick: async () => {
    if (!target.value && !tcSel.value) return toast('Choisissez une entreprise et/ou un TC', 'err');
    const fd = new FormData(); fd.set('month', month.value); fd.set('date', date.value); fd.set('amount', amount.value);
    if (target.value) fd.set('employer', target.value); if (tcSel.value) fd.set('tc_id', tcSel.value);
    if (file.files[0]) fd.set('file', file.files[0]);
    send.disabled = true;
    try { const r = await api('/api/transfers', { method: 'POST', form: fd }); toast(`Virement enregistré pour ${r.associates} Associate(s) — ${fcfa(r.total)} ✓`, 'ok'); file.value = ''; loadHist(); } catch (e) { toast(e.message, 'err'); }
    send.disabled = false;
  } }, 'Enregistrer le virement');
  root.append(h('div', { class: 'card' }, h('h2', {}, 'Enregistrer un virement'),
    h('p', { class: 'muted small' }, 'Le montant est appliqué à chaque Associate de l’entreprise (et/ou du TC) choisi — les deux filtres peuvent se combiner quand une entreprise a plusieurs TC — pour le mois indiqué, avec une preuve de virement commune. Vous pouvez le refaire pour corriger.'),
    h('div', { class: 'filters' }, target, tcSel, month, date, amount, file, send)),
    h('div', { class: 'card' }, h('h2', {}, 'Historique des virements'), hist));
  loadHist().catch((e) => hist.replaceChildren(h('div', { class: 'callout bad' }, e.message)));
  return root;
}
