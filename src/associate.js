import {
  fail, json, nowISO, today, sha256Hex, randToken, getSettings, programMonths, monthLabel, isMonth, isDate, isEmail,
  normPhone, sniffMime, EXT, clientIP, logEvent, bytesToBase64, base64ToBytes, tcOptions,
} from './util.js';
import { drainQueue } from './mail.js';

export const TEXT_VERSION = 'v1-2026-11';
export const DECLARATION_TEXT =
  "Je certifie sur l'honneur que les informations déclarées (montants, dates de réception et justificatifs) sont exactes et correspondent aux stipends que j'ai effectivement reçus dans le cadre du Programme Associates (Mastercard Foundation · Talent2Africa). J'autorise Talent2Africa à traiter ces données pour le suivi administratif et la vérification des paiements, et à les partager avec mon TalentCorps (TC) référent.";

const MAX_PROOF = 6 * 1024 * 1024;
const MAX_AMOUNT = 10_000_000;

async function getAssoc(env, token) {
  if (!/^[\w-]{20,64}$/.test(token || '')) fail(404, 'Lien invalide');
  const a = await env.DB.prepare(
    `SELECT a.*, s.name AS tc_name FROM associates a LEFT JOIN staff s ON s.id = a.tc_id WHERE a.token = ? AND a.active = 1`
  ).bind(token).first();
  if (!a) fail(404, 'Lien invalide ou désactivé');
  return a;
}

export async function loadMonths(env, associateId, months) {
  const { results } = await env.DB.prepare(
    `SELECT m.month, m.declared, m.amount, m.received_date, m.review, m.review_comment, m.proof_id, m.updated_at, m.sent_amount, m.sent_date, m.sent_proof_id, m.ext_proof_url, m.source,
            p.filename AS proof_name, p.mime AS proof_mime, p.size AS proof_size, p.uploaded_at AS proof_at
     FROM stipend_months m LEFT JOIN proofs p ON p.id = m.proof_id WHERE m.associate_id = ?`
  ).bind(associateId).all();
  const by = Object.fromEntries(results.map((r) => [r.month, r]));
  const list = new Set([...months, ...results.map((r) => r.month)]);
  return [...list].sort().map((month) => {
    const r = by[month] || {};
    return {
      month, label: monthLabel(month),
      declared: r.declared || null, amount: r.amount ?? null, received_date: r.received_date || null,
      review: r.review || 'pending', review_comment: r.review_comment || null,
      locked: r.review === 'confirmed',
      sent_amount: r.sent_amount ?? null, sent_date: r.sent_date || null, sent_proof: r.sent_proof_id || null,
      ext_proof_url: r.ext_proof_url || null, imported: r.source === 'import_form',
      proof: r.proof_id ? { id: r.proof_id, name: r.proof_name, mime: r.proof_mime, size: r.proof_size, at: r.proof_at } : null,
    };
  });
}

const publicAssoc = (a) => ({
  ref: a.ref, full_name: a.full_name, first_name: a.first_name, email: a.email, phone: a.phone, country: a.country,
  employer: a.employer, tc_name: a.tc_name || null, declared_tc: a.declared_tc, start_date: a.start_date,
  has_received: a.has_received, last_submitted_at: a.last_submitted_at, dirty: !!a.dirty,
});

const R2b64 = async (env, key) => {
  if (!key) return null;
  const o = await env.FILES.get(key);
  return o ? 'data:image/png;base64,' + bytesToBase64(new Uint8Array(await o.arrayBuffer())) : null;
};

export async function issueAttestation(env, a, actor) {
  const s = await getSettings(env);
  const n = Math.max(1, parseInt(s.attestation_months, 10) || 3);
  const { results } = await env.DB.prepare(
    `SELECT month, amount, received_date FROM stipend_months
     WHERE associate_id = ? AND declared = 'received' AND review = 'confirmed' ORDER BY month DESC LIMIT ?`
  ).bind(a.id, n).all();
  if (!results.length) fail(400, "Aucun mois n'a encore été confirmé par le TC : l'attestation n'est pas disponible.");
  const months = results.reverse().map((r) => ({ month: r.month, label: monthLabel(r.month), amount: r.amount, date: r.received_date }));
  const snapshot = {
    associate: { id: a.id, ref: a.ref, name: a.full_name, employer: a.employer, country: a.country },
    months, total: months.reduce((t, m) => t + (m.amount || 0), 0),
  };
  const hash = await sha256Hex(JSON.stringify([a.id, months]));
  let att = await env.DB.prepare('SELECT * FROM attestations WHERE associate_id = ? AND snapshot_hash = ? AND revoked = 0').bind(a.id, hash).first();
  if (!att) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = 'T2A-' + [...crypto.getRandomValues(new Uint8Array(8))].map((b) => alphabet[b % alphabet.length]).join('');
    att = { code, snapshot: JSON.stringify(snapshot), snapshot_hash: hash, issued_by: actor, issued_at: nowISO() };
    await env.DB.prepare('INSERT INTO attestations (code, associate_id, snapshot, snapshot_hash, issued_by, issued_at) VALUES (?,?,?,?,?,?)')
      .bind(code, a.id, att.snapshot, hash, actor, att.issued_at).run();
    await logEvent(env, a.id, actor, 'attestation', null, { code, months: months.map((m) => m.month) });
  }
  const lastDecl = await env.DB.prepare('SELECT signature_key, signed_at FROM declarations WHERE associate_id = ? ORDER BY id DESC LIMIT 1').bind(a.id).first();
  return {
    code: att.code, issued_at: att.issued_at, snapshot: JSON.parse(att.snapshot),
    verify_url: `${env.APP_URL}/verify/${att.code}`,
    signatory: { name: s.signatory_name, title: s.signatory_title, org: s.org_name, signature: await R2b64(env, 'settings/signatory.png') },
    associate_signature: await R2b64(env, lastDecl?.signature_key), associate_signed_at: lastDecl?.signed_at || null,
  };
}

export const associateRoutes = [
  // Lien perdu : renvoi du lien personnel (réponse neutre, 1 envoi / jour / associate).
  ['POST', /^\/api\/a\/resend$/, async ({ env, body, ctx }) => {
    const email = String(body.email || '').trim().toLowerCase();
    if (isEmail(email)) {
      await env.DB.prepare(
        `INSERT INTO email_queue (associate_id, to_email, kind, period, status, created_at)
         SELECT id, ?, 'link', ?, 'pending', ? FROM associates WHERE active = 1 AND (email = ? OR alt_email = ?)
         ON CONFLICT (associate_id, kind, period) DO NOTHING`
      ).bind(email, 'link:' + today(), nowISO(), email, email).run();
      ctx.waitUntil(drainQueue(env, 20));
    }
    return json({ ok: true });
  }],

  ['GET', /^\/api\/a\/([\w-]+)$/, async ({ env, m, ctx }) => {
    const a = await getAssoc(env, m[1]);
    const s = await getSettings(env);
    ctx.waitUntil(env.DB.prepare('UPDATE associates SET last_opened_at = ? WHERE id = ?').bind(nowISO(), a.id).run());
    const [months, events, att] = await Promise.all([
      loadMonths(env, a.id, programMonths(s)),
      env.DB.prepare(
        `SELECT type, month, data, created_at FROM events WHERE associate_id = ? AND type IN ('submitted','review_confirmed','review_disputed','attestation')
         ORDER BY id DESC LIMIT 30`
      ).bind(a.id).all(),
      env.DB.prepare(`SELECT COUNT(*) n FROM stipend_months WHERE associate_id = ? AND declared = 'received' AND review = 'confirmed'`).bind(a.id).first(),
    ]);
    return json({
      associate: publicAssoc(a), months, events: events.results.map((e) => ({ ...e, data: e.data ? JSON.parse(e.data) : null })),
      settings: { deadline: s.deadline, attestation_months: +s.attestation_months, support_email: s.support_email, support_whatsapp: s.support_whatsapp, tc_options: tcOptions(s) },
      declaration_text: DECLARATION_TEXT, can_attest: att.n > 0,
    });
  }],

  ['PUT', /^\/api\/a\/([\w-]+)\/profile$/, async ({ env, m, body }) => {
    const a = await getAssoc(env, m[1]);
    const phone = body.phone != null ? normPhone(body.phone) : a.phone;
    if (!phone) fail(400, 'Numéro de téléphone invalide (8 à 15 chiffres, avec indicatif pays).');
    let start = body.start_date || null;
    if (start && (!isDate(start) || start < '2025-06-01' || start > today())) fail(400, 'Date de démarrage invalide.');
    const tc = body.declared_tc ? String(body.declared_tc).trim().slice(0, 120) : null;
    const opts = tcOptions(await getSettings(env));
    if (tc && opts.length && tc !== 'Non précisé' && !opts.includes(tc)) fail(400, 'Choisissez votre TalentCorps (TC) dans la liste.');
    const employer = a.employer || (body.employer ? String(body.employer).trim().slice(0, 160) : null);
    await env.DB.prepare('UPDATE associates SET phone=?, start_date=?, declared_tc=?, employer=?, dirty=1, updated_at=? WHERE id=?')
      .bind(phone, start, tc, employer, nowISO(), a.id).run();
    await logEvent(env, a.id, 'associate', 'profile_saved', null, { phone: phone !== a.phone, start_date: start });
    return json({ ok: true, phone });
  }],

  ['PUT', /^\/api\/a\/([\w-]+)\/month\/(\d{4}-\d{2})$/, async ({ env, m, body }) => {
    const a = await getAssoc(env, m[1]);
    const month = m[2];
    const s = await getSettings(env);
    if (!isMonth(month) || !programMonths(s).includes(month)) fail(400, 'Mois non valide');
    const prev = await env.DB.prepare('SELECT * FROM stipend_months WHERE associate_id = ? AND month = ?').bind(a.id, month).first();
    if (prev?.review === 'confirmed') fail(423, 'Ce mois a déjà été confirmé par votre TC : il ne peut plus être modifié.');
    const declared = ['received', 'not_received'].includes(body.declared) ? body.declared : null;
    let amount = null, date = null;
    if (declared === 'received') {
      if (body.amount !== '' && body.amount != null) {
        amount = Math.round(Number(body.amount));
        if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) fail(400, 'Montant invalide (en FCFA).');
      }
      if (body.received_date) {
        if (!isDate(body.received_date) || body.received_date > today() || body.received_date < '2025-06-01') fail(400, 'Date de réception invalide.');
        date = body.received_date;
      }
    }
    const t = nowISO();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO stipend_months (associate_id, month, declared, amount, received_date, updated_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT (associate_id, month) DO UPDATE SET declared = excluded.declared, amount = excluded.amount,
           received_date = excluded.received_date, updated_at = excluded.updated_at,
           review = CASE WHEN review = 'disputed' THEN 'pending' ELSE review END`
      ).bind(a.id, month, declared, amount, date, t),
      env.DB.prepare('UPDATE associates SET dirty = 1, updated_at = ? WHERE id = ?').bind(t, a.id),
    ]);
    if (!prev || prev.declared !== declared || prev.amount !== amount || prev.received_date !== date)
      await logEvent(env, a.id, 'associate', 'month_saved', month, { declared, amount, date });
    return json({ ok: true });
  }],

  ['POST', /^\/api\/a\/([\w-]+)\/month\/(\d{4}-\d{2})\/proof$/, async ({ env, m, req }) => {
    const a = await getAssoc(env, m[1]);
    const month = m[2];
    const s = await getSettings(env);
    if (!programMonths(s).includes(month)) fail(400, 'Mois non valide');
    const prev = await env.DB.prepare('SELECT review FROM stipend_months WHERE associate_id = ? AND month = ?').bind(a.id, month).first();
    if (prev?.review === 'confirmed') fail(423, 'Ce mois a déjà été confirmé : le justificatif ne peut plus être remplacé.');
    const len = Number(req.headers.get('content-length') || 0);
    if (len > MAX_PROOF + 100_000) fail(413, 'Fichier trop volumineux (6 Mo maximum).');
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') fail(400, 'Aucun fichier reçu.');
    if (file.size > MAX_PROOF) fail(413, 'Fichier trop volumineux (6 Mo maximum).');
    if (file.size < 200) fail(400, 'Fichier vide ou illisible.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffMime(bytes);
    if (!mime) fail(415, 'Format non accepté. Envoyez une photo (JPG, PNG, WebP, HEIC) ou un PDF.');
    if (mime !== 'application/pdf' && bytes.length < 10_000) fail(400, 'Image trop petite pour être lisible. Envoyez la capture d’écran complète du SMS, du reçu ou de l’application de paiement.');
    const sha = await sha256Hex(bytes);
    const dup = await env.DB.prepare(`SELECT associate_id, month FROM proofs WHERE sha256 = ? AND kind = 'reception' AND NOT (associate_id = ? AND month = ?) LIMIT 1`).bind(sha, a.id, month).first();
    if (dup) fail(409, dup.associate_id === a.id ? 'Ce fichier a déjà été envoyé pour un autre mois. Envoyez le justificatif correspondant à CE mois.' : 'Ce justificatif a déjà été utilisé par un autre Associate. Envoyez votre propre preuve de réception.');
    const id = crypto.randomUUID();
    const key = `proofs/${a.id}/${month}/${id}.${EXT[mime]}`;
    await env.FILES.put(key, bytes, { httpMetadata: { contentType: mime } });
    const t = nowISO();
    const name = String(file.name || 'justificatif').replace(/[^\w.\- ()éèàùçÉ]/g, '_').slice(0, 100);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO proofs (id, associate_id, month, r2_key, filename, mime, size, uploaded_at, sha256) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(id, a.id, month, key, name, mime, bytes.length, t, sha),
      env.DB.prepare(
        `INSERT INTO stipend_months (associate_id, month, declared, proof_id, updated_at) VALUES (?,?, 'received', ?, ?)
         ON CONFLICT (associate_id, month) DO UPDATE SET proof_id = excluded.proof_id, declared = COALESCE(declared, 'received'),
           updated_at = excluded.updated_at, review = CASE WHEN review = 'disputed' THEN 'pending' ELSE review END`
      ).bind(a.id, month, id, t),
      env.DB.prepare('UPDATE associates SET dirty = 1, updated_at = ? WHERE id = ?').bind(t, a.id),
    ]);
    await logEvent(env, a.id, 'associate', 'proof_uploaded', month, { id, mime, size: bytes.length });
    return json({ ok: true, proof: { id, name, mime, size: bytes.length, at: t } });
  }],

  ['GET', /^\/api\/a\/([\w-]+)\/proof\/([\w-]+)$/, async ({ env, m }) => {
    const a = await getAssoc(env, m[1]);
    const p = await env.DB.prepare('SELECT * FROM proofs WHERE id = ? AND associate_id = ?').bind(m[2], a.id).first();
    if (!p) fail(404, 'Justificatif introuvable');
    return serveR2(env, p.r2_key, p.mime, p.filename);
  }],

  ['POST', /^\/api\/a\/([\w-]+)\/submit$/, async ({ env, m, body, req }) => {
    const a = await getAssoc(env, m[1]);
    const s = await getSettings(env);
    if (body.consent !== true) fail(400, 'Vous devez accepter la déclaration sur l\'honneur.');
    if (typeof body.has_received !== 'boolean') fail(400, 'Indiquez si vous avez déjà reçu un stipend.');
    const sig = String(body.signature || '');
    const mm = sig.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!mm || mm[1].length > 400_000) fail(400, 'Signature manquante ou invalide.');
    const sigBytes = base64ToBytes(mm[1]);
    if (sniffMime(sigBytes) !== 'image/png' || sigBytes.length < 600) fail(400, 'Veuillez signer dans le cadre prévu.');
    if (!normPhone(a.phone)) fail(400, 'Renseignez un numéro de téléphone valide à l\'étape 1.');
    if (!a.start_date) fail(400, 'Renseignez la date effective de démarrage de votre stage (étape 1).');
    if (!a.tc_name && !a.declared_tc) fail(400, 'Renseignez le nom de votre TalentCorps (TC) référent (étape 1).');

    const months = await loadMonths(env, a.id, programMonths(s));
    const received = months.filter((x) => x.declared === 'received');
    if (body.has_received) {
      if (!received.length) fail(400, 'Indiquez au moins un mois pour lequel vous avez reçu un stipend.');
      const problems = received.filter((x) => !x.amount || !x.received_date).map((x) => `${x.label} : montant et date requis`);
      if (problems.length) fail(400, 'Informations incomplètes : ' + problems.join(' · '));
      const noProof = received.filter((x) => !x.proof && !x.ext_proof_url).map((x) => x.label);
      if (noProof.length) fail(400, 'Justificatif de réception obligatoire (capture du SMS, reçu ou relevé) pour : ' + noProof.join(', '));
    } else if (received.length) {
      fail(400, 'Vous avez indiqué des mois reçus : répondez « Oui » ou retirez ces mois.');
    }
    const answered = months.filter((x) => x.declared);
    const snapshot = answered.map((x) => ({ month: x.month, declared: x.declared, amount: x.amount, date: x.received_date, proof: !!x.proof }));
    const sigId = crypto.randomUUID();
    const key = `signatures/${a.id}/${sigId}.png`;
    await env.FILES.put(key, sigBytes, { httpMetadata: { contentType: 'image/png' } });
    const hash = await sha256Hex(JSON.stringify({ a: a.id, snapshot, sig: await sha256Hex(sigBytes), v: TEXT_VERSION }));
    const t = nowISO();
    const first = received.length ? received[0].month : null;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO declarations (associate_id, signed_at, has_received, snapshot, signature_key, signature_sha256, ip, user_agent, text_version)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(a.id, t, body.has_received ? 1 : 0, JSON.stringify(snapshot), key, hash, clientIP(req), (req.headers.get('user-agent') || '').slice(0, 250), TEXT_VERSION),
      env.DB.prepare('UPDATE associates SET has_received=?, first_month=?, consent_at=?, last_submitted_at=?, dirty=0, updated_at=? WHERE id=?')
        .bind(body.has_received ? 1 : 0, first, t, t, t, a.id),
    ]);
    await logEvent(env, a.id, 'associate', 'submitted', null, { has_received: body.has_received, months: snapshot.length, received: received.length });
    return json({ ok: true, signed_at: t });
  }],

  ['POST', /^\/api\/a\/([\w-]+)\/attestation$/, async ({ env, m }) => {
    const a = await getAssoc(env, m[1]);
    return json(await issueAttestation(env, a, 'associate'));
  }],
];

export function serveR2(env, key, mime, filename) {
  return env.FILES.get(key).then((o) => {
    if (!o) fail(404, 'Fichier introuvable');
    return new Response(o.body, {
      headers: {
        'content-type': mime,
        'content-disposition': `inline; filename="${String(filename || 'fichier').replace(/[^\w.\- ]/g, '_')}"`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=300',
      },
    });
  });
}
