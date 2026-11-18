import { h, api, icon, fcfa, fdate, fdt, todayStr, mlabel, toast, modal, debounce, spinner, prepareProof, badge, REVIEW, brandBar } from './lib.js';
import { sigPad } from './sigpad.js';
import { buildAttestation, downloadBlob } from './pdf.js';

const dayLeft = (d) => (d ? Math.ceil((Date.parse(d + 'T23:59:59Z') - Date.now()) / 864e5) : null);

export async function renderAssociate(root, token) {
  root.replaceChildren(spinner('Ouverture de votre espace…'));
  let D;
  try { D = await api(`/api/a/${token}`); }
  catch (e) { root.replaceChildren(errorCard(e)); return; }

  const A = D.associate;
  const base = `/api/a/${token}`;
  let step = A.last_submitted_at && !A.dirty ? 'done' : 1;
  let hasReceived = A.has_received === 1 ? true : A.has_received === 0 ? false : D.months.some((m) => m.declared === 'received') ? true : null;
  const pad = sigPad({ onChange: () => refreshSignBtn() });
  let consent = false, submitting = false;
  const view = h('div');
  root.replaceChildren(header(), view);

  const disputed = () => D.months.filter((m) => m.review === 'disputed');
  const reload = async () => { D = await api(base); Object.assign(A, D.associate); };

  function header() {
    return brandBar();
  }

  function hero() {
    const dl = dayLeft(D.settings.deadline);
    return h('div', { class: 'hero' },
      h('h1', {}, `Bonjour ${A.first_name || A.full_name} 👋`),
      h('p', {}, 'Confirmez la réception de vos stipends (indemnités de stage) en 2 minutes. Vos informations sont enregistrées automatiquement.'),
      D.settings.deadline && dl != null && dl >= 0 ? h('span', { class: 'pill' }, `Date limite : ${fdate(D.settings.deadline)} · ${dl === 0 ? "aujourd'hui" : dl === 1 ? 'demain' : `dans ${dl} jours`}`) : null);
  }
  function stepper(n) {
    return h('div', { class: 'stepper', role: 'list' }, ['Vos infos', 'Vos stipends', 'Signature'].map((t, i) =>
      h('div', { class: 's' + (i + 1 === n ? ' on' : i + 1 < n ? ' done' : ''), role: 'listitem' }, h('i'), `${i + 1}. ${t}`)));
  }
  const bar = (...btns) => h('div', { class: 'stickybar' }, h('div', { class: 'in' }, btns));

  function draw() {
    window.scrollTo({ top: 0 });
    if (step === 'done') return view.replaceChildren(h('div', { class: 'wrap' }, hero(), disputeCallout(), doneView()));
    const body = step === 1 ? step1() : step === 2 ? step2() : step3();
    view.replaceChildren(h('div', { class: 'wrap' }, hero(), disputeCallout(), stepper(step), body.content), body.bar);
    body.after?.();
  }

  function disputeCallout() {
    const d = disputed();
    if (!d.length) return null;
    return h('div', { class: 'callout bad' }, h('b', {}, 'Votre TC demande une correction'),
      d.map((m) => h('p', { class: 'mb0 mt-s' }, `${m.label} : « ${m.review_comment || 'à vérifier'} »`)),
      step === 'done' ? h('button', { class: 'btn sm mt-s', onclick: () => { step = 2; draw(); } }, 'Corriger maintenant') : null);
  }

  // ---------------- Étape 1 ----------------
  function step1() {
    const phone = h('input', { class: 'input', type: 'tel', inputmode: 'tel', autocomplete: 'tel', value: A.phone || '', placeholder: 'Ex. 221771234567', 'aria-label': 'Numéro de téléphone' });
    const start = h('input', { class: 'input', type: 'date', value: A.start_date || '', min: '2025-06-01', max: todayStr() });
    const tcOpts = (D.settings && D.settings.tc_options) || [];
    const tc = tcOpts.length
      ? h('select', { class: 'input', 'aria-label': 'Votre TalentCorps (TC) référent' },
          h('option', { value: '' }, 'Choisissez votre TalentCorps…'),
          ...tcOpts.map((n) => h('option', { value: n, selected: n === A.declared_tc }, n)),
          h('option', { value: 'Non précisé', selected: A.declared_tc === 'Non précisé' }, 'Je ne sais pas encore'))
      : h('input', { class: 'input', value: A.declared_tc || '', placeholder: 'Prénom et nom de votre TC', maxlength: 120 });
    const emp = h('input', { class: 'input', value: A.employer || '', placeholder: 'Nom de votre entreprise', maxlength: 160 });
    const err = h('div', { class: 'err' });
    [phone, start, tc, emp].forEach((el) => ['input', 'change'].forEach((ev) => el.addEventListener(ev, () => { el.classList.remove('bad'); err.textContent = ''; })));
    const next = h('button', { class: 'btn primary grow', onclick: async () => {
      err.textContent = '';
      if (!/^(\+|00)?\d[\d\s().-]{6,}$/.test(phone.value.trim())) return fail(phone, 'Entrez un numéro valide, avec l’indicatif du pays (ex. 221…).');
      if (!start.value) return fail(start, 'Indiquez la date effective de démarrage de votre stage.');
      if (!A.tc_name && !tc.value.trim()) return fail(tc, 'Choisissez votre TalentCorps (TC) référent dans la liste.');
      if (!A.employer && !emp.value.trim()) return fail(emp, 'Indiquez votre entreprise.');
      next.disabled = true;
      try {
        await api(`${base}/profile`, { method: 'PUT', body: { phone: phone.value, start_date: start.value, declared_tc: tc.value, employer: emp.value } });
        A.phone = phone.value.replace(/\D/g, ''); A.start_date = start.value; A.declared_tc = tc.value.trim(); if (!A.employer) A.employer = emp.value.trim();
        step = 2; draw();
      } catch (e) { err.textContent = e.message; next.disabled = false; }
    } }, 'Continuer ', icon('check'));
    function fail(el, msg) { el.classList.add('bad'); el.focus(); err.textContent = msg; }
    const ro = (label, val) => h('div', { class: 'kv' }, h('b', {}, label), h('span', {}, val || '—'));
    return {
      content: h('div', {},
        h('div', { class: 'card' }, h('h2', {}, 'Vérifiez vos informations'),
          h('p', { class: 'muted small' }, 'Identifié grâce à l’adresse e-mail de votre candidature Academy4Africa.'),
          ro('Nom et prénom(s)', A.full_name), ro('E-mail', A.email), ro('Réf.', A.ref)),
        h('div', { class: 'card' }, h('h2', {}, 'À compléter'),
          h('label', { class: 'f' }, 'Numéro de téléphone *'), phone,
          h('label', { class: 'f' }, 'Date effective de démarrage du stage *'), start,
          A.employer ? h('div', {}, h('label', { class: 'f' }, 'Entreprise'), h('input', { class: 'input', readOnly: true, value: A.employer })) : h('div', {}, h('label', { class: 'f' }, 'Entreprise *'), emp),
          A.tc_name ? h('div', {}, h('label', { class: 'f' }, 'Votre TalentCorps (TC) référent'), h('input', { class: 'input', readOnly: true, value: A.tc_name }))
            : h('div', {}, h('label', { class: 'f' }, 'Votre TalentCorps (TC) référent *'), tc),
          err)),
      bar: bar(next),
    };
  }

  // ---------------- Étape 2 ----------------
  function step2() {
    const list = h('div');
    const msg = h('div');
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Avez-vous déjà reçu un stipend ?' });
    const drawSeg = () => seg.replaceChildren(
      h('button', { class: 'yes', 'aria-pressed': String(hasReceived === true), onclick: () => { hasReceived = true; drawSeg(); drawList(); } }, 'Oui, déjà reçu'),
      h('button', { class: 'no', 'aria-pressed': String(hasReceived === false), onclick: () => {
        if (D.months.some((m) => m.declared === 'received')) { msg.replaceChildren(h('div', { class: 'callout warn' }, 'Vous avez saisi des mois reçus. Passez-les en « Pas encore reçu » ou répondez Oui.')); return; }
        hasReceived = false; drawSeg(); drawList();
      } }, 'Non, pas encore'));
    function drawList() {
      msg.replaceChildren();
      if (hasReceived == null) return list.replaceChildren();
      if (hasReceived === false) return list.replaceChildren(h('div', { class: 'callout info' }, 'Pas de souci : indiquez-le simplement et signez à l’étape suivante. Vous pourrez revenir dès que vous aurez reçu un stipend.'));
      list.replaceChildren(...[h('h2', { class: 'mt' }, 'Pour quels mois avez-vous reçu un stipend ?'),
        h('p', { class: 'muted small' }, 'Pour chaque mois : choisissez « Reçu », puis renseignez le montant, la date et ajoutez la preuve (capture du virement, reçu Mobile Money, relevé…).'),
        ...D.months.map((m) => monthCard(m)), firstMonthNote()].filter(Boolean));
    }
    drawSeg(); drawList();
    const back = h('button', { class: 'btn', onclick: () => { step = 1; draw(); } }, 'Retour');
    const next = h('button', { class: 'btn primary grow', onclick: () => {
      if (hasReceived == null) { msg.replaceChildren(h('div', { class: 'err' }, 'Répondez d’abord à la question ci-dessus.')); seg.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      if (hasReceived) {
        const rec = D.months.filter((m) => m.declared === 'received');
        if (!rec.length) { msg.replaceChildren(h('div', { class: 'err' }, 'Choisissez « Reçu » pour au moins un mois, ou répondez « Non ».')); return; }
        const bad = rec.find((m) => !m.amount || !m.received_date);
        if (bad) { toast(`${bad.label} : ajoutez le montant et la date`, 'err'); document.getElementById('m-' + bad.month)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      }
      step = 3; draw();
    } }, 'Continuer ', icon('check'));
    return {
      content: h('div', {}, h('div', { class: 'card' }, h('h2', {}, 'Avez-vous déjà reçu un stipend ?'), h('p', { class: 'muted small' }, 'Dans le cadre du Programme Associates, depuis le début de votre stage.'), seg, msg), list),
      bar: bar(back, next),
    };
  }

  function firstMonthNote() {
    const f = D.months.find((m) => m.declared === 'received');
    return f ? h('p', { class: 'muted small center' }, `Premier stipend reçu : ${f.label}`) : null;
  }

  function monthCard(m) {
    const locked = m.locked;
    const card = h('div', { class: 'month', id: 'm-' + m.month });
    const saved = h('div', { class: 'saved' });
    const amount = h('input', { class: 'input mono', type: 'number', inputmode: 'numeric', min: '1', step: '1', value: m.amount ?? '', placeholder: 'Ex. 75000', disabled: locked, 'aria-label': `Montant reçu pour ${m.label}` });
    const date = h('input', { class: 'input', type: 'date', value: m.received_date || '', max: todayStr(), min: '2025-06-01', disabled: locked, 'aria-label': `Date de réception pour ${m.label}` });
    const fields = h('div');
    const save = debounce(async () => {
      saved.textContent = 'Enregistrement…'; saved.style.color = '';
      try {
        await api(`${base}/month/${m.month}`, { method: 'PUT', body: { declared: m.declared, amount: amount.value || null, received_date: date.value || null } });
        m.amount = amount.value ? Math.round(+amount.value) : null; m.received_date = date.value || null;
        if (m.review === 'disputed') { m.review = 'pending'; paint(); }
        saved.textContent = '✓ Enregistré'; saved.style.color = '';
      } catch (e) { saved.textContent = e.message; saved.style.color = 'var(--red)'; }
    }, 600);
    amount.addEventListener('input', save); date.addEventListener('input', save);

    async function setDeclared(v) {
      m.declared = v; paint();
      save.cancel(); await save.flush();
    }

    function proofArea() {
      const input = h('input', { type: 'file', accept: 'image/*,application/pdf', class: 'hidden', onchange: () => up(input.files[0]) });
      const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', onchange: () => up(cam.files[0]) });
      async function up(f) {
        if (!f) return;
        saved.textContent = 'Envoi du justificatif…';
        try {
          const file = await prepareProof(f);
          const fd = new FormData(); fd.append('file', file, file.name);
          if (amount.value || date.value) { save.cancel(); await save.flush(); }
          const r = await api(`${base}/month/${m.month}/proof`, { method: 'POST', form: fd });
          m.proof = r.proof; if (!m.declared) m.declared = 'received';
          if (m.review === 'disputed') m.review = 'pending';
          paint(); toast('Justificatif ajouté ✓', 'ok');
        } catch (e) { saved.textContent = e.message; saved.style.color = 'var(--red)'; toast(e.message, 'err'); }
      }
      if (m.proof) {
        const isImg = m.proof.mime.startsWith('image/');
        return h('div', { class: 'drop has' }, h('div', { class: 'proof' },
          isImg ? h('img', { class: 'thumb', src: `${base}/proof/${m.proof.id}`, alt: 'Justificatif' }) : h('div', { class: 'thumb' }, 'PDF'),
          h('div', { class: 'grow' }, h('b', {}, '✓ Justificatif ajouté'), h('div', { class: 'small muted' }, `${m.proof.name} · ${Math.max(1, Math.round(m.proof.size / 1024))} Ko`),
            h('div', { class: 'row gap-s mt-s' },
              h('a', { class: 'btn sm', href: `${base}/proof/${m.proof.id}`, target: '_blank', rel: 'noopener' }, 'Voir'),
              locked ? null : h('button', { class: 'btn sm', onclick: () => input.click() }, 'Remplacer'))), input));
      }
      return h('div', { class: 'drop', onclick: (e) => { if (!e.target.closest('button')) input.click(); } },
        h('div', {}, icon('upload', 22)), h('b', {}, 'Ajouter la preuve de réception'),
        h('div', { class: 'small muted' }, 'Photo, capture d’écran ou PDF · 6 Mo max'),
        h('div', { class: 'small', style: { marginTop: '6px' } }, 'La preuve doit montrer clairement le montant, la date et votre nom ou numéro (SMS, reçu ou relevé).'),
        h('div', { class: 'row gap-s', style: { justifyContent: 'center', marginTop: '10px' } },
          h('button', { class: 'btn sm primary', onclick: (e) => { e.stopPropagation(); cam.click(); } }, icon('camera', 16), 'Prendre une photo'),
          h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); input.click(); } }, icon('file', 16), 'Choisir un fichier')), input, cam);
    }

    function paint() {
      card.className = 'month' + (m.declared === 'received' ? ' received' : '') + (locked ? ' locked' : '') + (m.review === 'disputed' ? ' disputed' : '');
      const rv = m.declared === 'received' ? REVIEW[m.review] : null;
      const head = h('div', { class: 'head' }, h('h3', {}, m.label), rv ? badge((locked ? '🔒 ' : '') + rv[0], rv[1]) : m.declared === 'not_received' ? badge('Pas encore reçu', 'b-grey') : badge('À renseigner', 'b-amber'));
      const toggle = h('div', { class: 'seg', role: 'group', 'aria-label': `Stipend de ${m.label}` },
        h('button', { class: 'yes', disabled: locked, 'aria-pressed': String(m.declared === 'received'), onclick: () => setDeclared('received') }, 'Reçu'),
        h('button', { class: 'no', disabled: locked, 'aria-pressed': String(m.declared === 'not_received'), onclick: () => setDeclared('not_received') }, 'Pas encore reçu'));
      const parts = [head, toggle];
      if (m.review === 'disputed' && m.review_comment) parts.push(h('div', { class: 'callout bad mt-s mb0' }, `Message du TC : ${m.review_comment}`));
      if (locked) parts.push(h('p', { class: 'small muted mt-s mb0' }, 'Confirmé par votre TC : ce mois ne peut plus être modifié.'));
      if (m.declared === 'received') {
        fields.replaceChildren(h('div', { class: 'cols' },
          h('div', {}, h('label', { class: 'f' }, 'Montant reçu *'), h('div', { class: 'inline-money' }, amount, h('span', {}, 'FCFA'))),
          h('div', {}, h('label', { class: 'f' }, 'Date de réception *'), date)),
          h('div', { class: 'mt-s' }, proofArea()));
        parts.push(fields);
      }
      parts.push(saved);
      card.replaceChildren(...parts);
    }
    paint();
    return card;
  }

  // ---------------- Étape 3 ----------------
  function step3() {
    const rows = D.months.filter((m) => m.declared);
    const missing = D.months.filter((m) => !m.declared).map((m) => m.label);
    const noProof = D.months.filter((m) => m.declared === 'received' && !m.proof && !m.ext_proof_url);
    const tbl = hasReceived ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Mois', 'Montant', 'Date', 'Preuve'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((m) => h('tr', { style: { cursor: 'default' } }, h('td', {}, m.label),
        h('td', { class: 'mono' }, m.declared === 'received' ? fcfa(m.amount) : h('span', { class: 'muted' }, 'Pas encore reçu')),
        h('td', {}, m.declared === 'received' ? fdate(m.received_date) : '—'), h('td', {}, m.declared === 'received' ? (m.proof || m.ext_proof_url ? '✓' : badge('Manquante', 'b-amber')) : '—')))))) : h('div', { class: 'callout info' }, 'Vous déclarez ne pas avoir encore reçu de stipend.');
    const consentBox = h('input', { type: 'checkbox', onchange: (e) => { consent = e.target.checked; refreshSignBtn(); } });
    consentBox.checked = consent;
    const err = h('div', { class: 'err' });
    const send = h('button', { class: 'btn primary grow', onclick: async () => {
      if (submitting) return;
      err.textContent = '';
      submitting = true; refreshSignBtn();
      try {
        await api(`${base}/submit`, { method: 'POST', body: { has_received: !!hasReceived, consent: true, signature: pad.toDataURL() } });
        await reload(); consent = false; pad.clear(); step = 'done'; draw();
      } catch (e) { err.textContent = e.message; toast(e.message, 'err'); }
      submitting = false; refreshSignBtn();
    } }, icon('pen'), ' Signer et envoyer');
    refreshSignBtn = () => { send.disabled = !(consent && !pad.isEmpty()) || submitting; send.replaceChildren(icon('pen'), submitting ? ' Envoi…' : ' Signer et envoyer'); };
    refreshSignBtn();
    const back = h('button', { class: 'btn', onclick: () => { step = 2; draw(); } }, 'Retour');
    return {
      content: h('div', {},
        h('div', { class: 'card' }, h('h2', {}, 'Récapitulatif'), tbl,
          missing.length ? h('div', { class: 'callout warn mt-s mb0' }, `Mois non renseignés : ${missing.join(', ')}. Vous pourrez les compléter plus tard.`) : null,
          noProof.length ? h('div', { class: 'callout warn mt-s mb0' }, `Preuve manquante pour : ${noProof.map((m) => m.label).join(', ')}. Vous pouvez signer maintenant et l’ajouter plus tard.`) : null),
        h('div', { class: 'card' }, h('h2', {}, 'Déclaration sur l’honneur'), h('div', { class: 'legal' }, D.declaration_text),
          h('label', { class: 'chk mt-s' }, consentBox, h('span', {}, 'Je certifie l’exactitude de ces informations et j’accepte leur traitement tel que décrit ci-dessus. *'))),
        h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h2', { class: 'mb0' }, 'Votre signature'), h('button', { class: 'btn sm', onclick: () => pad.clear() }, 'Effacer')),
          h('p', { class: 'muted small mt-s' }, 'Dessinez votre signature dans le cadre.'), pad.el, err)),
      bar: bar(back, send),
    };
  }
  let refreshSignBtn = () => {};

  // ---------------- Terminé ----------------
  function doneView() {
    const rec = D.months.filter((m) => m.declared === 'received');
    const conf = rec.filter((m) => m.review === 'confirmed').length;
    const attBtn = h('button', { class: 'btn primary', onclick: async () => {
      attBtn.disabled = true;
      try { const p = await api(`${base}/attestation`, { method: 'POST' }); downloadBlob(await buildAttestation(p), `attestation-stipends-${p.code}.pdf`); toast('Attestation téléchargée ✓', 'ok'); }
      catch (e) { toast(e.message, 'err'); }
      attBtn.disabled = false;
    } }, icon('download'), `Télécharger mon attestation (${D.settings.attestation_months} derniers mois confirmés)`);
    return h('div', {},
      h('div', { class: 'card center' }, h('div', { class: 'done-ic' }, icon('check', 38)),
        h('h2', {}, 'Merci, votre déclaration est enregistrée'),
        h('p', { class: 'muted' }, `Signée le ${fdt(A.last_submitted_at)}. ` + (rec.length ? `${conf}/${rec.length} mois confirmé(s) par votre TC.` : 'Vous avez indiqué ne pas avoir encore reçu de stipend.')),
        h('div', { class: 'row', style: { justifyContent: 'center' } },
          h('button', { class: 'btn', onclick: () => { step = 2; draw(); } }, 'Modifier ou ajouter un mois'), D.can_attest ? attBtn : null),
        D.can_attest ? null : h('p', { class: 'small muted mt-s mb0' }, 'L’attestation sera disponible dès qu’un mois aura été confirmé par votre TC.')),
      rec.length ? h('div', { class: 'card' }, h('h2', {}, 'Mes mois déclarés'), D.months.filter((m) => m.declared).map((m) => h('div', { class: 'kv' },
        h('div', { class: 'row between' }, h('b', { style: { textTransform: 'none', fontSize: '1rem', color: 'var(--ink)' } }, m.label),
          m.declared === 'received' ? badge(REVIEW[m.review][0], REVIEW[m.review][1]) : badge('Pas encore reçu', 'b-grey')),
        m.declared === 'received' ? h('span', { class: 'muted small' }, `${fcfa(m.amount)} · reçu le ${fdate(m.received_date)} · ${m.proof || m.ext_proof_url ? 'preuve ✓' : 'preuve manquante'}`) : null))) : null,
      D.events.length ? h('div', { class: 'card' }, h('h2', {}, 'Historique'), h('ul', { class: 'timeline' }, D.events.map((e) => h('li', {}, h('span', { class: 'dot' }), h('div', {}, eventText(e), h('div', { class: 'small muted' }, fdt(e.created_at))))))) : null,
      h('p', { class: 'small muted center' }, 'Vous recevrez un e-mail le 10 de chaque mois pour mettre à jour vos informations. ',
        D.settings.support_email ? h('a', { href: 'mailto:' + D.settings.support_email }, D.settings.support_email) : null));
  }
  const eventText = (e) => ({
    submitted: 'Déclaration signée et envoyée', review_confirmed: `${e.month ? mlabel(e.month) + ' : ' : ''}confirmé par votre TC`,
    review_disputed: `${e.month ? mlabel(e.month) + ' : ' : ''}correction demandée${e.data?.comment ? ' — ' + e.data.comment : ''}`, attestation: 'Attestation générée',
  }[e.type] || e.type);

  draw();
}

function errorCard(e) {
  return h('div', {}, brandBar(),
    h('div', { class: 'wrap' }, h('div', { class: 'card center' }, h('h2', {}, e.status === 404 ? 'Ce lien n’est pas valide' : 'Une erreur est survenue'),
      h('p', { class: 'muted' }, e.status === 404 ? 'Il a peut-être été remplacé ou désactivé. Demandez à recevoir à nouveau votre lien personnel.' : e.message),
      h('a', { class: 'btn primary', href: '/' }, 'Recevoir mon lien par e-mail'))));
}
