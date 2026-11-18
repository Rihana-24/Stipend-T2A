import {
  GROUPS, groupOf, DEFAULT_RATE, cfaId,
  fail, json, nowISO, today, currentMonth, getSettings, programMonths, dueMonths, monthLabel, isMonth, isDate, isEmail, normPhone,
  randToken, sniffMime, toCSV, logEvent, DEFAULT_SETTINGS, tcOptions, EXT,
} from './util.js';
import { requireUser } from './auth.js';
import { loadMonths, issueAttestation, serveR2 } from './associate.js';
import { drainQueue, mailConfigured } from './mail.js';

const AGG = `LEFT JOIN (
  SELECT associate_id,
    COUNT(CASE WHEN declared IS NOT NULL THEN 1 END) AS n_answered,
    COALESCE(SUM(declared = 'received'), 0) AS n_received,
    COALESCE(SUM(declared = 'received' AND review = 'confirmed'), 0) AS n_confirmed,
    COALESCE(SUM(declared = 'received' AND review = 'pending'), 0) AS n_pending,
    COALESCE(SUM(declared = 'received' AND review = 'disputed'), 0) AS n_disputed,
    COALESCE(SUM(declared = 'received' AND proof_id IS NULL AND ext_proof_url IS NULL), 0) AS n_noproof,
    COALESCE(SUM(CASE WHEN declared = 'received' THEN amount END), 0) AS total
  FROM stipend_months GROUP BY associate_id) g ON g.associate_id = a.id`;

const STATUS = {
  none: 'a.last_submitted_at IS NULL AND a.dirty = 0',
  draft: 'a.dirty = 1',
  submitted: 'a.last_submitted_at IS NOT NULL AND a.dirty = 0',
  no_stipend: 'a.last_submitted_at IS NOT NULL AND a.has_received = 0',
  toreview: 'COALESCE(g.n_pending,0) > 0',
  disputed: 'COALESCE(g.n_disputed,0) > 0',
  confirmed: 'COALESCE(g.n_received,0) > 0 AND g.n_confirmed = g.n_received',
  noproof: 'COALESCE(g.n_noproof,0) > 0',
  nolink: 'a.link_sent_at IS NULL',
  linksent: 'a.link_sent_at IS NOT NULL',
  notopened: 'a.link_sent_at IS NOT NULL AND a.last_opened_at IS NULL',
  opened: 'a.last_opened_at IS NOT NULL',
};

function buildWhere(user, q) {
  const w = ['a.active = 1'], p = [];
  if (user.role === 'tc') { w.push('a.tc_id = ?'); p.push(user.id); }
  if (q.get('search')) {
    const like = `%${q.get('search').trim()}%`;
    w.push('(a.full_name LIKE ? OR a.email LIKE ? OR a.phone LIKE ? OR a.ref LIKE ? OR a.employer LIKE ? OR (lower(replace(a.id, \'-\', \'\')) || \'ta\') LIKE lower(?))');
    p.push(like, like, like, like, like, like);
  }
  if (q.get('employer')) {
    if (q.get('employer') === '__none') w.push("(a.employer IS NULL OR a.employer = '')");
    else { w.push('a.employer = ?'); p.push(q.get('employer')); }
  }
  if (q.get('country')) { w.push('a.country = ?'); p.push(q.get('country')); }
  if (q.get('tc') === 'none') w.push('a.tc_id IS NULL');
  else if (q.get('tc')) { w.push('a.tc_id = ?'); p.push(Number(q.get('tc'))); }
  const st = q.get('status');
  if (st && STATUS[st]) w.push(`(${STATUS[st]})`);
  const miss = q.get('missing');
  if (isMonth(miss)) {
    w.push(`NOT EXISTS (SELECT 1 FROM stipend_months x WHERE x.associate_id = a.id AND x.month = ? AND x.declared IS NOT NULL)`);
    p.push(miss);
  }
  return { where: w.join(' AND '), params: p };
}

async function getAssocFor(env, user, id) {
  const a = await env.DB.prepare('SELECT a.*, s.name AS tc_name FROM associates a LEFT JOIN staff s ON s.id = a.tc_id WHERE a.id = ?').bind(id).first();
  if (!a || (user.role === 'tc' && a.tc_id !== user.id)) fail(404, 'Associate introuvable');
  return a;
}

export async function enqueue(env, { kind, period, target = 'all', ids = [] }) {
  const s = await getSettings(env);
  const due = dueMonths(s);
  let cond = '1=1';
  const binds = [kind, period, nowISO()];
  if (target === 'nonresponders') {
    cond = `(a.last_submitted_at IS NULL OR a.dirty = 1 OR (SELECT COUNT(*) FROM stipend_months m WHERE m.associate_id = a.id AND m.declared IS NOT NULL AND m.month IN (SELECT value FROM json_each(?))) < ?)`;
    binds.push(JSON.stringify(due), due.length);
  } else if (target === 'ids') {
    cond = 'a.id IN (SELECT value FROM json_each(?))';
    binds.push(JSON.stringify(ids));
  }
  const r = await env.DB.prepare(
    `INSERT INTO email_queue (associate_id, to_email, kind, period, status, created_at)
     SELECT a.id, a.email, ?, ?, 'pending', ? FROM associates a
     WHERE a.active = 1 AND a.email IS NOT NULL AND a.email <> '' AND ${cond}
     ON CONFLICT (associate_id, kind, period) DO NOTHING`
  ).bind(...binds).run();
  return r.meta.changes || 0;
}

export async function backupToR2(env) {
  const tables = ['staff', 'associates', 'stipend_months', 'proofs', 'declarations', 'attestations', 'events', 'settings'];
  const out = { created_at: nowISO() };
  for (const t of tables) out[t] = (await env.DB.prepare(`SELECT * FROM ${t}`).all()).results;
  const key = `backups/${today()}.json`;
  await env.FILES.put(key, JSON.stringify(out), { httpMetadata: { contentType: 'application/json' } });
  const list = await env.FILES.list({ prefix: 'backups/' });
  const old = list.objects.map((o) => o.key).sort().slice(0, -30);
  if (old.length) await env.FILES.delete(old);
  return { key, rows: Object.fromEntries(tables.map((t) => [t, out[t].length])) };
}

const admin = (env, req) => requireUser(env, req, ['admin']);
const staffAny = (env, req) => requireUser(env, req);

export const staffRoutes = [
  // ---------- Public : vérification d'une attestation ----------
  ['GET', /^\/api\/verify\/([A-Z0-9-]{6,20})$/, async ({ env, m }) => {
    const r = await env.DB.prepare('SELECT * FROM attestations WHERE code = ?').bind(m[1]).first();
    if (!r || r.revoked) return json({ valid: false });
    const s = await getSettings(env);
    const snap = JSON.parse(r.snapshot);
    return json({ valid: true, code: r.code, issued_at: r.issued_at, org: s.org_name, name: snap.associate.name, employer: snap.associate.employer, months: snap.months, total: snap.total });
  }],

  // ---------- Tableau de bord ----------
  ['GET', /^\/api\/stats$/, async ({ env, req }) => {
    const u = await staffAny(env, req);
    const s = await getSettings(env);
    const sc = u.role === 'tc' ? ' AND a.tc_id = ?' : '';
    const p = u.role === 'tc' ? [u.id] : [];
    const [t, byMonth, byEmp, byTc, mail] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) total,
        COALESCE(SUM(a.last_submitted_at IS NOT NULL AND a.dirty = 0),0) submitted, COALESCE(SUM(a.dirty = 1),0) draft,
        COALESCE(SUM(a.last_submitted_at IS NULL AND a.dirty = 0),0) none,
        COALESCE(SUM(a.last_submitted_at IS NOT NULL AND a.has_received = 1),0) with_stipend,
        COALESCE(SUM(a.last_submitted_at IS NOT NULL AND a.has_received = 0),0) no_stipend,
        COALESCE(SUM(g.n_pending > 0),0) to_review, COALESCE(SUM(g.n_disputed > 0),0) disputed,
        COALESCE(SUM(g.n_received > 0 AND g.n_confirmed = g.n_received),0) fully_confirmed,
        COALESCE(SUM(g.n_noproof > 0),0) missing_proof, COALESCE(SUM(g.total),0) total_amount,
        COALESCE(SUM(a.tc_id IS NULL),0) unassigned,
        COALESCE(SUM(a.link_sent_at IS NOT NULL),0) link_sent, COALESCE(SUM(a.last_opened_at IS NOT NULL),0) opened,
        COALESCE(SUM(a.link_sent_at IS NOT NULL AND a.last_opened_at IS NULL),0) not_opened
        FROM associates a ${AGG} WHERE a.active = 1${sc}`).bind(...p).first(),
      env.DB.prepare(`SELECT sm.month, COALESCE(SUM(sm.declared='received'),0) received, COALESCE(SUM(sm.declared='not_received'),0) not_received,
        COALESCE(SUM(sm.declared='received' AND sm.review='confirmed'),0) confirmed, COALESCE(SUM(sm.declared='received' AND sm.review='disputed'),0) disputed,
        COALESCE(SUM(sm.declared='received' AND sm.proof_id IS NULL AND sm.ext_proof_url IS NULL),0) noproof, COALESCE(SUM(CASE WHEN sm.declared='received' THEN sm.amount END),0) amount
        FROM stipend_months sm JOIN associates a ON a.id = sm.associate_id WHERE a.active = 1${sc} GROUP BY sm.month ORDER BY sm.month`).bind(...p).all(),
      env.DB.prepare(`SELECT COALESCE(NULLIF(a.employer,''),'(non renseignée)') employer, COUNT(*) total,
        COALESCE(SUM(a.last_submitted_at IS NOT NULL AND a.dirty = 0),0) submitted, COALESCE(SUM(g.n_pending > 0),0) to_review
        FROM associates a ${AGG} WHERE a.active = 1${sc} GROUP BY 1 ORDER BY total DESC LIMIT 15`).bind(...p).all(),
      u.role === 'admin'
        ? env.DB.prepare(`SELECT a.tc_id id, COALESCE(s.name,'Non assigné') name, COUNT(*) total,
            COALESCE(SUM(a.last_submitted_at IS NOT NULL AND a.dirty = 0),0) submitted, COALESCE(SUM(g.n_pending > 0),0) to_review
            FROM associates a ${AGG} LEFT JOIN staff s ON s.id = a.tc_id WHERE a.active = 1 GROUP BY a.tc_id ORDER BY total DESC`).all()
        : Promise.resolve({ results: [] }),
      u.role === 'admin' ? env.DB.prepare(`SELECT status, COUNT(*) n FROM email_queue GROUP BY status`).all() : Promise.resolve({ results: [] }),
    ]);
    const dl = s.deadline ? Math.ceil((Date.parse(s.deadline + 'T23:59:59Z') - Date.now()) / 864e5) : null;
    return json({
      totals: t, by_month: byMonth.results, by_employer: byEmp.results, by_tc: byTc.results,
      mail: { configured: mailConfigured(env), queue: Object.fromEntries(mail.results.map((r) => [r.status, r.n])) },
      deadline: s.deadline, days_left: dl, months: programMonths(s), due_months: dueMonths(s), role: u.role,
    });
  }],

  ['GET', /^\/api\/filters$/, async ({ env, req }) => {
    const u = await staffAny(env, req);
    const sc = u.role === 'tc' ? ' AND tc_id = ?' : '';
    const p = u.role === 'tc' ? [u.id] : [];
    const [emp, cty, tcs] = await Promise.all([
      env.DB.prepare(`SELECT employer, COUNT(*) n FROM associates WHERE active = 1 AND employer IS NOT NULL AND employer <> ''${sc} GROUP BY employer ORDER BY employer`).bind(...p).all(),
      env.DB.prepare(`SELECT country, COUNT(*) n FROM associates WHERE active = 1 AND country IS NOT NULL${sc} GROUP BY country ORDER BY n DESC`).bind(...p).all(),
      env.DB.prepare(`SELECT id, name, email, role FROM staff WHERE active = 1 ORDER BY name`).all(),
    ]);
    return json({ employers: emp.results, countries: cty.results, tcs: u.role === 'admin' ? tcs.results.filter((x) => x.role === 'tc' || x.role === 'admin') : [] });
  }],

  // ---------- Liste / export ----------
  ['GET', /^\/api\/associates$/, async ({ env, req, url }) => {
    const u = await staffAny(env, req);
    const q = url.searchParams;
    const { where, params } = buildWhere(u, q);
    const fmt = q.get('format');
    const from = `FROM associates a ${AGG} LEFT JOIN staff s ON s.id = a.tc_id`;
    const base = `${from} WHERE ${where}`;
    if (fmt === 'csv') {
      const s = await getSettings(env);
      const stamp = today();
      if (q.get('layout') === 'long') {
        const { results } = await env.DB.prepare(
          `SELECT a.ref, a.id, a.full_name, a.email, a.phone, a.country, a.employer, s.name tc, sm.month, sm.declared, sm.amount, sm.received_date,
                  CASE WHEN sm.proof_id IS NULL AND sm.ext_proof_url IS NULL THEN 'Non' ELSE 'Oui' END proof, sm.review, sm.review_comment
           ${from} JOIN stipend_months sm ON sm.associate_id = a.id AND sm.declared IS NOT NULL WHERE ${where} ORDER BY a.ref, sm.month`
        ).bind(...params).all();
        const rows = [['Réf', 'Associate ID', 'Nom et prénom', 'Email', 'Téléphone', 'Pays', 'Entreprise', 'TC référent', 'Mois', 'Stipend reçu', 'Montant (FCFA)', 'Date de réception', 'Preuve jointe', 'Statut TC', 'Commentaire TC'],
          ...results.map((r) => [r.ref, cfaId(r.id), r.full_name, r.email, r.phone, r.country, r.employer, r.tc, monthLabel(r.month), r.declared === 'received' ? 'Oui' : 'Non', r.amount, r.received_date, r.proof, { pending: 'À valider', confirmed: 'Confirmé', disputed: 'Litige' }[r.review], r.review_comment])];
        return csvResponse(toCSV(rows), `stipends-historique-${stamp}.csv`);
      }
      const { results } = await env.DB.prepare(
        `SELECT a.*, s.name tc_name, COALESCE(g.n_received,0) n_received, COALESCE(g.n_confirmed,0) n_confirmed, COALESCE(g.n_pending,0) n_pending,
                COALESCE(g.n_disputed,0) n_disputed, COALESCE(g.n_noproof,0) n_noproof, COALESCE(g.total,0) total ${base} ORDER BY a.ref`
      ).bind(...params).all();
      const months = programMonths(s);
      const byAssoc = {};
      if (results.length) {
        const sm = await env.DB.prepare(`SELECT associate_id, month, declared, amount FROM stipend_months WHERE associate_id IN (SELECT value FROM json_each(?))`)
          .bind(JSON.stringify(results.map((r) => r.id))).all();
        for (const x of sm.results) (byAssoc[x.associate_id] ||= {})[x.month] = x;
      }
      const head = ['Réf', 'Associate ID', 'Nom et prénom', 'Email', 'Téléphone', 'Pays', 'Entreprise', 'KPMG ID employeur', 'TC référent', 'TC déclaré', 'Genre', 'R/DP', 'PWD', 'Alumni MCF', 'Rural/Urbain', 'Date de placement (CFA)', 'Date de démarrage', 'Réponse', 'Stipend reçu', 'Mois reçus', 'Total reçu (FCFA)', 'Confirmés', 'À valider', 'Litiges', 'Sans preuve', 'Dernière soumission', ...months.map(monthLabel)];
      const rows = results.map((r) => [r.ref, cfaId(r.id), r.full_name, r.email, r.phone, r.country, r.employer, r.employer_kpmg_id, r.tc_name, r.declared_tc, { F: 'Femme', M: 'Homme' }[r.gender] || '', { refugee: 'Réfugié', idp: 'Déplacé interne', both: 'Réfugié + déplacé', rdp: 'R/DP' }[r.rdp] || 'Non', r.pwd ? 'Oui' : 'Non', { scholar: 'Scholar MCF', other: 'Autre programme MCF' }[r.mcf] || 'Non alumni', { urban: 'Urbain', rural: 'Rural' }[r.area] || '', r.placement_start, r.start_date,
        r.last_submitted_at ? (r.dirty ? 'Modifié, à re-signer' : 'Soumis') : r.dirty ? 'En cours' : 'Non répondu',
        r.has_received == null ? '' : r.has_received ? 'Oui' : 'Non', r.n_received, r.total, r.n_confirmed, r.n_pending, r.n_disputed, r.n_noproof, r.last_submitted_at,
        ...months.map((m) => { const x = byAssoc[r.id]?.[m]; return !x || !x.declared ? '' : x.declared === 'received' ? (x.amount ?? 'reçu') : 'non reçu'; })]);
      return csvResponse(toCSV([head, ...rows]), `stipends-associates-${stamp}.csv`);
    }
    const limit = Math.min(200, Math.max(1, parseInt(q.get('limit'), 10) || 50));
    const offset = Math.max(0, parseInt(q.get('offset'), 10) || 0);
    const [cnt, rows] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) n ${base}`).bind(...params).first(),
      env.DB.prepare(
        `SELECT a.id, a.ref, a.full_name, a.email, a.phone, a.country, a.employer, a.tc_id, s.name tc_name, a.declared_tc, a.start_date, a.has_received, a.pwd, a.gender, a.rdp, a.mcf, a.placement_start, a.employer_kpmg_id, a.link_sent_at, a.link_channel,
                a.last_submitted_at, a.dirty, a.last_opened_at,
                COALESCE(g.n_answered,0) n_answered, COALESCE(g.n_received,0) n_received, COALESCE(g.n_confirmed,0) n_confirmed, COALESCE(g.n_pending,0) n_pending,
                COALESCE(g.n_disputed,0) n_disputed, COALESCE(g.n_noproof,0) n_noproof, COALESCE(g.total,0) total
         ${base} ORDER BY a.ref LIMIT ? OFFSET ?`
      ).bind(...params, limit, offset).all(),
    ]);
    return json({ total: cnt.n, items: rows.results, limit, offset });
  }],

  ['GET', /^\/api\/associates\/([\w-]+)$/, async ({ env, req, m }) => {
    const u = await staffAny(env, req);
    const a = await getAssocFor(env, u, m[1]);
    const s = await getSettings(env);
    const [months, decl, events, atts] = await Promise.all([
      loadMonths(env, a.id, programMonths(s)),
      env.DB.prepare('SELECT id, signed_at, has_received, snapshot, text_version, ip FROM declarations WHERE associate_id = ? ORDER BY id DESC LIMIT 20').bind(a.id).all(),
      env.DB.prepare('SELECT id, actor, type, month, data, created_at FROM events WHERE associate_id = ? ORDER BY id DESC LIMIT 120').bind(a.id).all(),
      env.DB.prepare('SELECT code, issued_at, issued_by FROM attestations WHERE associate_id = ? AND revoked = 0 ORDER BY issued_at DESC LIMIT 10').bind(a.id).all(),
    ]);
    const { token, ...safe } = a;
    return json({
      associate: u.role === 'admin' ? { ...safe, token } : safe, months,
      declarations: decl.results.map((d) => ({ ...d, snapshot: JSON.parse(d.snapshot) })),
      events: events.results.map((e) => ({ ...e, data: e.data ? JSON.parse(e.data) : null })), attestations: atts.results,
    });
  }],

  ['PATCH', /^\/api\/associates\/([\w-]+)$/, async ({ env, req, m, body }) => {
    const u = await admin(env, req);
    const a = await getAssocFor(env, u, m[1]);
    const f = {};
    if ('tc_id' in body) {
      if (body.tc_id !== null && !(await env.DB.prepare('SELECT 1 x FROM staff WHERE id = ? AND active = 1').bind(body.tc_id).first())) fail(400, 'TC introuvable');
      f.tc_id = body.tc_id;
    }
    if ('employer' in body) f.employer = String(body.employer || '').trim().slice(0, 160) || null;
    if ('start_date' in body) { if (body.start_date && !isDate(body.start_date)) fail(400, 'Date invalide'); f.start_date = body.start_date || null; }
    if ('phone' in body) { const p = normPhone(body.phone); if (!p) fail(400, 'Téléphone invalide'); f.phone = p; }
    if ('email' in body) { if (!isEmail(body.email)) fail(400, 'Email invalide'); f.email = body.email.trim().toLowerCase(); }
    if ('active' in body) f.active = body.active ? 1 : 0;
    if ('pwd' in body) f.pwd = body.pwd ? 1 : 0;
    const keys = Object.keys(f);
    if (!keys.length) fail(400, 'Rien à modifier');
    await env.DB.prepare(`UPDATE associates SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(...keys.map((k) => f[k]), nowISO(), a.id).run();
    await logEvent(env, a.id, `staff:${u.email}`, 'associate_updated', null, f);
    return json({ ok: true });
  }],

  ['POST', /^\/api\/associates\/([\w-]+)\/regen-link$/, async ({ env, req, m }) => {
    const u = await admin(env, req);
    const a = await getAssocFor(env, u, m[1]);
    const token = randToken(24);
    await env.DB.prepare('UPDATE associates SET token = ? WHERE id = ?').bind(token, a.id).run();
    await logEvent(env, a.id, `staff:${u.email}`, 'link_regenerated');
    return json({ ok: true, token });
  }],

  // ---------- Validation par le TC ----------
  ['POST', /^\/api\/associates\/([\w-]+)\/review$/, async ({ env, req, m, body, ctx }) => {
    const u = await staffAny(env, req);
    const a = await getAssocFor(env, u, m[1]);
    const { month, status } = body;
    const comment = String(body.comment || '').trim().slice(0, 500);
    if (!isMonth(month) || !['confirmed', 'disputed', 'pending'].includes(status)) fail(400, 'Requête invalide');
    if (status === 'disputed' && comment.length < 3) fail(400, 'Indiquez le motif du litige pour que l\'Associate puisse corriger.');
    const row = await env.DB.prepare('SELECT * FROM stipend_months WHERE associate_id = ? AND month = ?').bind(a.id, month).first();
    if (!row || row.declared !== 'received') fail(400, 'Aucun stipend déclaré pour ce mois.');
    const t = nowISO();
    await env.DB.prepare(`UPDATE stipend_months SET review = ?, review_comment = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE associate_id = ? AND month = ?`)
      .bind(status, status === 'pending' ? null : comment || null, status === 'pending' ? null : u.email, status === 'pending' ? null : t, t, a.id, month).run();
    await logEvent(env, a.id, `staff:${u.email}`, `review_${status}`, month, { comment: comment || null, proof: !!row.proof_id });
    if (status === 'disputed' && a.email) {
      await env.DB.prepare(`INSERT INTO email_queue (associate_id, to_email, kind, period, payload, status, created_at) VALUES (?,?, 'dispute', ?, ?, 'pending', ?)
        ON CONFLICT (associate_id, kind, period) DO NOTHING`).bind(a.id, a.email, `${month}:${t}`, JSON.stringify({ label: monthLabel(month), comment }), t).run();
      ctx.waitUntil(drainQueue(env, 10));
    }
    return json({ ok: true });
  }],

  ['POST', /^\/api\/review-bulk$/, async ({ env, req, body }) => {
    const u = await staffAny(env, req);
    const t = nowISO();
    const scope = u.role === 'tc' ? ' AND associate_id IN (SELECT id FROM associates WHERE tc_id = ?)' : '';
    const sp = u.role === 'tc' ? [u.id] : [];
    let cond, cp;
    if (body.mode === 'all_pending_with_proof') {
      cond = `declared = 'received' AND review = 'pending' AND (proof_id IS NOT NULL OR ext_proof_url IS NOT NULL) AND amount IS NOT NULL`; cp = [];
    } else {
      const items = (body.items || []).filter((i) => i && typeof i.id === 'string' && isMonth(i.month)).slice(0, 500);
      if (!items.length) fail(400, 'Aucune sélection');
      cond = `declared = 'received' AND review = 'pending' AND (associate_id, month) IN (SELECT json_extract(value,'$.id'), json_extract(value,'$.month') FROM json_each(?))`;
      cp = [JSON.stringify(items)];
    }
    await env.DB.prepare(`INSERT INTO events (associate_id, actor, type, month, data, created_at)
      SELECT associate_id, ?, 'review_confirmed', month, '{"bulk":true}', ? FROM stipend_months WHERE ${cond}${scope}`).bind(`staff:${u.email}`, t, ...cp, ...sp).run();
    const r = await env.DB.prepare(`UPDATE stipend_months SET review = 'confirmed', review_comment = NULL, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE ${cond}${scope}`)
      .bind(u.email, t, t, ...cp, ...sp).run();
    return json({ ok: true, confirmed: r.meta.changes || 0 });
  }],

  ['GET', /^\/api\/proof\/([\w-]+)$/, async ({ env, req, m }) => {
    const u = await staffAny(env, req);
    const p = await env.DB.prepare('SELECT * FROM proofs WHERE id = ?').bind(m[1]).first();
    if (!p) fail(404, 'Justificatif introuvable');
    await getAssocFor(env, u, p.associate_id);
    return serveR2(env, p.r2_key, p.mime, p.filename);
  }],

  ['GET', /^\/api\/declarations\/(\d+)\/signature$/, async ({ env, req, m }) => {
    const u = await staffAny(env, req);
    const d = await env.DB.prepare('SELECT * FROM declarations WHERE id = ?').bind(m[1]).first();
    if (!d) fail(404, 'Introuvable');
    await getAssocFor(env, u, d.associate_id);
    return serveR2(env, d.signature_key, 'image/png', 'signature.png');
  }],

  ['POST', /^\/api\/associates\/([\w-]+)\/attestation$/, async ({ env, req, m }) => {
    const u = await staffAny(env, req);
    const a = await getAssocFor(env, u, m[1]);
    return json(await issueAttestation(env, a, `staff:${u.email}`));
  }],



  ['POST', /^\/api\/links\/mark-sent$/, async ({ env, req, body }) => {
    const u = await staffAny(env, req);
    const ids = (body.ids || []).filter((x) => typeof x === 'string').slice(0, 500);
    if (!ids.length) fail(400, 'Aucun Associate sélectionné');
    const channel = ['whatsapp', 'email', 'manual'].includes(body.channel) ? body.channel : 'manual';
    const scope = u.role === 'tc' ? ' AND tc_id = ?' : '';
    const r = await env.DB.prepare(`UPDATE associates SET link_sent_at = ?, link_channel = ? WHERE id IN (SELECT value FROM json_each(?))${scope}`)
      .bind(nowISO(), channel, JSON.stringify(ids), ...(u.role === 'tc' ? [u.id] : [])).run();
    return json({ ok: true, updated: r.meta.changes || 0 });
  }],

  // ---------- Placements, financement, virements ----------
  ['GET', /^\/api\/placements$/, async ({ env, req }) => {
    const u = await staffAny(env, req);
    const s = await getSettings(env);
    const isTc = u.role === 'tc';
    const sc = isTc ? ' AND a.tc_id = ?' : '';
    const p = isTc ? [u.id] : [];
    const [tcRows, ctyRows, empRows, profRows] = await Promise.all([
      env.DB.prepare(`SELECT COALESCE(s.name, NULLIF(trim(a.declared_tc), ''), 'Non assigné') tc,
          COUNT(*) placed,
          COALESCE(SUM(COALESCE(g.n_received,0) > 0 AND g.n_confirmed = g.n_received),0) validated,
          COALESCE(SUM(COALESCE(g.n_pending,0) > 0),0) to_review,
          COALESCE(SUM(a.pwd),0) pwd, COALESCE(SUM(a.gender = 'F'),0) women, COALESCE(SUM(a.gender = 'M'),0) men,
          COALESCE(SUM(a.rdp IS NOT NULL),0) rdp, COALESCE(SUM(a.mcf IS NULL),0) non_alumni,
          COALESCE(SUM(e.funding = 'full'),0) n_full, COALESCE(SUM(e.funding = 'shared'),0) n_shared, COALESCE(SUM(e.funding IS NULL),0) n_undef,
          COALESCE(SUM(CASE e.funding WHEN 'full' THEN e.rate WHEN 'shared' THEN e.rate / 2 ELSE 0 END),0) monthly_foundation,
          COALESCE(SUM(g.sent),0) sent, COALESCE(SUM(g.recv),0) received,
          COALESCE(SUM(g.n_sent),0) n_sent, COALESCE(SUM(g.sent_proofs),0) sent_proofs,
          COALESCE(SUM(g.n_recv),0) n_recv, COALESCE(SUM(g.recv_proofs),0) recv_proofs
        FROM associates a LEFT JOIN staff s ON s.id = a.tc_id LEFT JOIN employers e ON e.name = a.employer
        LEFT JOIN (SELECT associate_id,
            SUM(declared = 'received') n_recv, SUM(declared = 'received' AND review = 'confirmed') n_confirmed, SUM(declared = 'received') n_received,
            SUM(declared = 'received' AND review = 'pending') n_pending,
            SUM(CASE WHEN declared = 'received' THEN amount END) recv,
            SUM(declared = 'received' AND (proof_id IS NOT NULL OR ext_proof_url IS NOT NULL)) recv_proofs,
            SUM(sent_amount) sent, SUM(sent_amount IS NOT NULL) n_sent, SUM(sent_amount IS NOT NULL AND sent_proof_id IS NOT NULL) sent_proofs
          FROM stipend_months GROUP BY associate_id) g ON g.associate_id = a.id
        WHERE a.active = 1${sc} GROUP BY lower(COALESCE(s.name, NULLIF(trim(a.declared_tc), ''), 'Non assigné'))`).bind(...p).all(),
      isTc ? Promise.resolve({ results: [] }) : env.DB.prepare('SELECT country, COUNT(*) n, COALESCE(SUM(pwd),0) pwd FROM associates WHERE active = 1 GROUP BY country').all(),
      isTc ? Promise.resolve({ results: [] }) : env.DB.prepare(`SELECT e.name, e.funding, e.rate, e.quota, e.placed_file, e.note, COALESCE(c.n,0) n, COALESCE(c.pwd,0) pwd
          FROM employers e LEFT JOIN (SELECT employer, COUNT(*) n, SUM(pwd) pwd FROM associates WHERE active = 1 GROUP BY employer) c ON c.employer = e.name
          WHERE c.n > 0 OR e.quota > 0 ORDER BY e.name COLLATE NOCASE`).all(),
      env.DB.prepare(`SELECT a.country, COUNT(*) n, COALESCE(SUM(a.gender = 'F'),0) women, COALESCE(SUM(a.gender = 'M'),0) men, COALESCE(SUM(a.rdp IS NOT NULL),0) rdp,
          COALESCE(SUM(a.rdp IN ('refugee','both')),0) refugees, COALESCE(SUM(a.rdp IN ('idp','both')),0) idp, COALESCE(SUM(a.pwd),0) pwd, COALESCE(SUM(a.mcf IS NOT NULL),0) alumni,
          COALESCE(SUM(a.mcf = 'scholar'),0) scholars, COALESCE(SUM(a.gender IS NOT NULL),0) profiled, COALESCE(SUM(a.area = 'rural'),0) rural
        FROM associates a WHERE a.active = 1${sc} GROUP BY a.country`).bind(...p).all(),
    ]);
    // Tous les TC de la liste officielle apparaissent, même à 0, dans l'ordre alphabétique.
    const byName = new Map(tcRows.results.map((r) => [r.tc.toLowerCase(), r]));
    const zero = (tc) => ({ tc, women: 0, men: 0, rdp: 0, non_alumni: 0, placed: 0, validated: 0, to_review: 0, pwd: 0, n_full: 0, n_shared: 0, n_undef: 0, monthly_foundation: 0, sent: 0, received: 0, n_sent: 0, sent_proofs: 0, n_recv: 0, recv_proofs: 0 });
    const names = isTc ? [] : tcOptions(s).filter((n) => n !== 'Non précisé');
    const rows = [...tcRows.results];
    for (const n of names) if (!byName.has(n.toLowerCase())) rows.push(zero(n));
    rows.sort((a, b) => (a.tc === 'Non assigné') - (b.tc === 'Non assigné') || a.tc.localeCompare(b.tc, 'fr', { sensitivity: 'base' }));
    rows.forEach((r) => { r.remaining = Math.max(0, r.placed - r.validated); });
    const sum = (k) => rows.reduce((t, r) => t + (r[k] || 0), 0);
    const parse = (v) => { try { return JSON.parse(v) || {}; } catch { return {}; } };
    const targets = parse(s.placement_targets), placedFile = parse(s.placed_file);
    const inTool = {}, pwdBy = {};
    for (const c of ctyRows.results) { const k = groupOf(c.country); inTool[k] = (inTool[k] || 0) + c.n; pwdBy[k] = (pwdBy[k] || 0) + c.pwd; }
    const groups = isTc ? [] : GROUPS.map((g) => {
      const target = Number(targets[g.key]) || 0, file = placedFile[g.key] ?? null, tool = inTool[g.key] || 0, placed = Math.max(Number(file) || 0, tool);
      return { key: g.key, label: g.label, target, placed_file: file, in_tool: tool, placed, remaining: Math.max(0, target - placed), pwd: pwdBy[g.key] || 0 };
    });
    const KEYS = ['n', 'women', 'men', 'rdp', 'refugees', 'idp', 'pwd', 'alumni', 'scholars', 'profiled', 'rural'];
    const profByGroup = {};
    for (const c of profRows.results) { const k = groupOf(c.country); const o = (profByGroup[k] ||= Object.fromEntries(KEYS.map((x) => [x, 0]))); KEYS.forEach((x) => (o[x] += c[x])); }
    const profTotal = Object.fromEntries(KEYS.map((x) => [x, Object.values(profByGroup).reduce((t, o) => t + o[x], 0)]));
    profTotal.non_alumni = profTotal.profiled - profTotal.alumni;
    const profile = { total: profTotal, groups: GROUPS.map((g) => ({ key: g.key, label: g.label, ...(profByGroup[g.key] || Object.fromEntries(KEYS.map((x) => [x, 0]))) })).filter((g) => g.n) };
    return json({
      role: u.role, profile, rows, groups, default_rate: DEFAULT_RATE,
      totals: { placed: sum('placed'), validated: sum('validated'), remaining: sum('remaining'), pwd: sum('pwd'), n_full: sum('n_full'), n_shared: sum('n_shared'), n_undef: sum('n_undef'),
        monthly_foundation: sum('monthly_foundation'), sent: sum('sent'), received: sum('received'), n_sent: sum('n_sent'), sent_proofs: sum('sent_proofs'), n_recv: sum('n_recv'), recv_proofs: sum('recv_proofs'),
        target: groups.reduce((t, g) => t + g.target, 0), placed_groups: groups.reduce((t, g) => t + g.placed, 0) },
      employers: empRows.results,
    });
  }],

  ['PUT', /^\/api\/placements\/targets$/, async ({ env, req, body }) => {
    const u = await admin(env, req);
    const clean = (o) => Object.fromEntries(GROUPS.filter((g) => o && o[g.key] !== '' && o[g.key] != null && Number.isFinite(Number(o[g.key])) && Number(o[g.key]) >= 0).map((g) => [g.key, Math.round(Number(o[g.key]))]));
    const st = env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    await env.DB.batch([st.bind('placement_targets', JSON.stringify(clean(body.targets))), st.bind('placed_file', JSON.stringify(clean(body.placed)))]);
    await logEvent(env, null, `staff:${u.email}`, 'settings_updated', null, { keys: ['placement_targets', 'placed_file'] });
    return json({ ok: true });
  }],

  ['PUT', /^\/api\/employers$/, async ({ env, req, body }) => {
    const u = await admin(env, req);
    const items = (body.items || []).slice(0, 250).map((x) => {
      const funding = x.funding === 'full' || x.funding === 'shared' ? x.funding : null;
      const rate = Math.round(Number(x.rate) || DEFAULT_RATE);
      if (rate < 1000 || rate > 1_000_000) fail(400, `Montant mensuel invalide pour ${x.name}`);
      return { name: String(x.name || '').trim(), funding, rate, quota: x.quota === '' || x.quota == null ? null : Math.max(0, Math.round(Number(x.quota) || 0)) };
    }).filter((x) => x.name);
    if (!items.length) fail(400, 'Rien à enregistrer');
    const r = await env.DB.prepare(
      `UPDATE employers SET funding = j.funding, rate = j.rate, quota = j.quota
       FROM (SELECT json_extract(value,'$.name') name, json_extract(value,'$.funding') funding, json_extract(value,'$.rate') rate, json_extract(value,'$.quota') quota FROM json_each(?)) j
       WHERE employers.name = j.name`).bind(JSON.stringify(items)).run();
    await logEvent(env, null, `staff:${u.email}`, 'employers_updated', null, { count: items.length });
    return json({ ok: true, updated: r.meta.changes || 0 });
  }],

  ['GET', /^\/api\/transfers$/, async ({ env, req }) => {
    await admin(env, req);
    const { results } = await env.DB.prepare(
      `SELECT COALESCE(a.employer,'(non renseignée)') employer, sm.month, COUNT(*) n, SUM(sm.sent_amount) sent, MAX(sm.sent_date) sent_date,
              SUM(CASE WHEN sm.declared = 'received' THEN sm.amount END) received, SUM(sm.declared = 'received') n_received,
              SUM(sm.sent_proof_id IS NOT NULL) proofs, MAX(sm.sent_proof_id) proof_id
       FROM stipend_months sm JOIN associates a ON a.id = sm.associate_id WHERE sm.sent_amount IS NOT NULL
       GROUP BY 1, 2 ORDER BY sm.month DESC, employer LIMIT 400`).all();
    return json({ items: results });
  }],

  // Enregistre un virement (même montant) pour tous les Associates d'une entreprise ou d'un TC, avec une preuve commune facultative.
  ['POST', /^\/api\/transfers$/, async ({ env, req }) => {
    const u = await admin(env, req);
    const len = Number(req.headers.get('content-length') || 0);
    if (len > 6_100_000) fail(413, 'Fichier trop volumineux (6 Mo maximum).');
    const f = await req.formData();
    const month = String(f.get('month') || ''), date = String(f.get('date') || ''), amount = Math.round(Number(f.get('amount')));
    const employer = String(f.get('employer') || '').trim(), tcId = Number(f.get('tc_id')) || null;
    if (!isMonth(month)) fail(400, 'Mois invalide');
    if (!isDate(date)) fail(400, 'Date du virement invalide');
    if (!(amount >= 1000 && amount <= 1_000_000)) fail(400, 'Montant invalide (par Associate, en FCFA)');
    if (!employer && !tcId) fail(400, 'Choisissez une entreprise et/ou un TC');
    const conds = [], cvs = [];
    if (employer) { conds.push('a.employer = ?'); cvs.push(employer); }
    if (tcId) { conds.push('a.tc_id = ?'); cvs.push(tcId); }
    const cond = conds.join(' AND ');
    const file = f.get('file');
    const t = nowISO();
    const batch = crypto.randomUUID().slice(0, 8);
    let proofExpr = 'NULL', pre = [];
    if (file && typeof file !== 'string' && file.size) {
      if (file.size > 6_000_000) fail(413, 'Fichier trop volumineux (6 Mo maximum).');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = sniffMime(bytes);
      if (!mime) fail(415, 'Format non accepté. Envoyez une photo (JPG, PNG, WebP) ou un PDF.');
      const key = `transfers/${batch}/${crypto.randomUUID()}.${EXT[mime]}`;
      await env.FILES.put(key, bytes, { httpMetadata: { contentType: mime } });
      const name = String(file.name || 'preuve-virement').replace(/[^\w.\- ()éèàùçÉ]/g, '_').slice(0, 100);
      pre.push(env.DB.prepare(`INSERT OR REPLACE INTO proofs (id, associate_id, month, r2_key, filename, mime, size, uploaded_at, kind)
        SELECT ? || '-' || a.ref, a.id, ?, ?, ?, ?, ?, ?, 'transfer' FROM associates a WHERE a.active = 1 AND ${cond}`).bind(batch, month, key, name, mime, bytes.length, t, ...cvs));
      proofExpr = `'${batch}-' || a.ref`;
    }
    const ins = env.DB.prepare(`INSERT INTO stipend_months (associate_id, month, sent_amount, sent_date, sent_proof_id, updated_at)
      SELECT a.id, ?, ?, ?, ${proofExpr}, ? FROM associates a WHERE a.active = 1 AND ${cond}
      ON CONFLICT (associate_id, month) DO UPDATE SET sent_amount = excluded.sent_amount, sent_date = excluded.sent_date,
        sent_proof_id = COALESCE(excluded.sent_proof_id, sent_proof_id), updated_at = excluded.updated_at`).bind(month, amount, date, t, ...cvs);
    const res = await env.DB.batch([...pre, ins]);
    const n = res[res.length - 1].meta.changes || 0;
    if (!n) fail(404, 'Aucun Associate trouvé pour cette sélection.');
    await logEvent(env, null, `staff:${u.email}`, 'transfer_recorded', month, { employer: employer || null, tc_id: tcId, amount, date, associates: n, proof: proofExpr !== 'NULL' });
    return json({ ok: true, associates: n, total: n * amount });
  }],

  // ---------- Administration ----------
  ['POST', /^\/api\/associates\/assign$/, async ({ env, req, body }) => {
    const u = await admin(env, req);
    const tc = body.tc_id ?? null;
    if (tc !== null && !(await env.DB.prepare('SELECT 1 x FROM staff WHERE id = ? AND active = 1').bind(tc).first())) fail(400, 'TC introuvable');
    const t = nowISO();
    let r;
    if (Array.isArray(body.ids) && body.ids.length)
      r = await env.DB.prepare('UPDATE associates SET tc_id = ?, updated_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(tc, t, JSON.stringify(body.ids.slice(0, 1000))).run();
    else if (body.employer) {
      const onlyFree = body.only_unassigned ? ' AND tc_id IS NULL' : '';
      r = await env.DB.prepare(`UPDATE associates SET tc_id = ?, updated_at = ? WHERE active = 1 AND employer = ?${onlyFree}`).bind(tc, t, body.employer).run();
    } else fail(400, 'Précisez des Associates ou une entreprise.');
    await logEvent(env, null, `staff:${u.email}`, 'bulk_assign', null, { tc_id: tc, count: r.meta.changes, employer: body.employer || null });
    return json({ ok: true, updated: r.meta.changes || 0 });
  }],

  // Rattache chaque Associate sans TC au TC (compte existant) dont le nom est identique à celui qu'il a choisi.
  ['POST', /^\/api\/associates\/assign-declared$/, async ({ env, req }) => {
    const u = await admin(env, req);
    const match = `SELECT s.id FROM staff s WHERE s.role IN ('tc','admin') AND s.active = 1 AND lower(trim(s.name)) = lower(trim(associates.declared_tc))`;
    const r = await env.DB.prepare(
      `UPDATE associates SET tc_id = (${match}), updated_at = ? WHERE active = 1 AND tc_id IS NULL AND declared_tc IS NOT NULL AND EXISTS (${match})`).bind(nowISO()).run();
    const left = await env.DB.prepare(
      `SELECT COUNT(*) n FROM associates WHERE active = 1 AND tc_id IS NULL AND declared_tc IS NOT NULL AND declared_tc <> 'Non précisé'`).first();
    await logEvent(env, null, `staff:${u.email}`, 'assign_declared', null, { count: r.meta.changes || 0, unmatched: left.n });
    return json({ ok: true, updated: r.meta.changes || 0, unmatched: left.n });
  }],

  ['POST', /^\/api\/associates\/import$/, async ({ env, req, body }) => {
    const u = await admin(env, req);
    const rows = (body.rows || []).slice(0, 150);
    const clean = [], skipped = [];
    const tcs = (await env.DB.prepare('SELECT id, email, name FROM staff WHERE active = 1').all()).results;
    const unmatchedTc = new Set();
    const start = (await env.DB.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(ref, 5) AS INTEGER)), 0) n FROM associates").first()).n;
    rows.forEach((r, i) => {
      const email = String(r.email || '').trim().toLowerCase();
      if (!isEmail(email)) { skipped.push({ row: i + 1, reason: 'email invalide' }); return; }
      const full = String(r.full_name || `${r.first_name || ''} ${r.last_name || ''}`).replace(/\s+/g, ' ').trim();
      const tc = String(r.tc || '').trim();
      if (tc && !tcs.some((x) => x.email.toLowerCase() === tc.toLowerCase() || x.name.toLowerCase() === tc.toLowerCase())) unmatchedTc.add(tc);
      clean.push({
        id: String(r.id || '').trim(), email, full_name: full, first_name: String(r.first_name || '').trim(), last_name: String(r.last_name || '').trim(),
        phone: normPhone(r.phone) || '', country: String(r.country || '').trim(), employer: String(r.employer || '').trim(), tc,
        start_date: isDate(r.start_date) ? r.start_date : '', token: randToken(24),
      });
    });
    let updated = 0, created = 0;
    if (clean.length) {
      const j = JSON.stringify(clean);
      const t = nowISO();
      const up = await env.DB.prepare(
        `UPDATE associates SET
           employer = COALESCE(NULLIF(j.employer, ''), associates.employer), phone = COALESCE(NULLIF(j.phone, ''), associates.phone),
           start_date = COALESCE(NULLIF(j.start_date, ''), associates.start_date), country = COALESCE(NULLIF(j.country, ''), associates.country),
           tc_id = COALESCE((SELECT id FROM staff WHERE active = 1 AND (lower(email) = lower(j.tc) OR lower(name) = lower(j.tc)) LIMIT 1), associates.tc_id), updated_at = ?
         FROM (SELECT lower(json_extract(value,'$.email')) email, json_extract(value,'$.employer') employer, json_extract(value,'$.phone') phone,
                      json_extract(value,'$.start_date') start_date, json_extract(value,'$.country') country, json_extract(value,'$.tc') tc FROM json_each(?)) j
         WHERE lower(associates.email) = j.email`
      ).bind(t, j).run();
      updated = up.meta.changes || 0;
      const ins = await env.DB.prepare(
        `INSERT INTO associates (id, ref, token, first_name, last_name, full_name, email, phone, country, employer, start_date, tc_id)
         SELECT COALESCE(NULLIF(j.id, ''), lower(hex(randomblob(16)))), 'ASC-' || printf('%04d', ? + j.rn + 1), j.token, j.first_name, j.last_name,
                COALESCE(NULLIF(j.full_name, ''), j.email), j.email, NULLIF(j.phone, ''), NULLIF(j.country, ''), NULLIF(j.employer, ''), NULLIF(j.start_date, ''),
                (SELECT id FROM staff WHERE active = 1 AND (lower(email) = lower(j.tc) OR lower(name) = lower(j.tc)) LIMIT 1)
         FROM (SELECT CAST(key AS INTEGER) rn, json_extract(value,'$.id') id, lower(json_extract(value,'$.email')) email, json_extract(value,'$.token') token,
                      json_extract(value,'$.first_name') first_name, json_extract(value,'$.last_name') last_name, json_extract(value,'$.full_name') full_name,
                      json_extract(value,'$.phone') phone, json_extract(value,'$.country') country, json_extract(value,'$.employer') employer,
                      json_extract(value,'$.start_date') start_date, json_extract(value,'$.tc') tc FROM json_each(?)) j
         WHERE NOT EXISTS (SELECT 1 FROM associates x WHERE lower(x.email) = j.email)`
      ).bind(start, j).run();
      created = ins.meta.changes || 0;
    }
    await logEvent(env, null, `staff:${u.email}`, 'import', null, { received: rows.length, updated, created, skipped: skipped.length });
    return json({ ok: true, updated, created, skipped, unmatched_tc: [...unmatchedTc] });
  }],

  ['POST', /^\/api\/invite$/, async ({ env, req, body, ctx }) => {
    const u = await admin(env, req);
    const kind = body.kind === 'reminder' ? 'reminder' : 'invite';
    const target = ['all', 'nonresponders', 'ids'].includes(body.target) ? body.target : 'nonresponders';
    if (target === 'ids' && !(body.ids || []).length) fail(400, 'Aucune sélection');
    // Campagne (tous / non-répondants) : 1 seul envoi par Associate et par mois (anti double-clic).
    // Renvoi volontaire à une sélection, ou force:true : nouvel envoi autorisé.
    const deliberate = target === 'ids' || body.force === true;
    const period = deliberate ? `manual:${Date.now()}` : `manual:${currentMonth()}`;
    const queued = await enqueue(env, { kind, period, target, ids: (body.ids || []).slice(0, 1000) });
    await logEvent(env, null, `staff:${u.email}`, 'mail_enqueued', null, { kind, target, queued });
    if (mailConfigured(env)) ctx.waitUntil(drainQueue(env, 100));
    return json({ ok: true, queued, mail_configured: mailConfigured(env) });
  }],

  ['GET', /^\/api\/emails$/, async ({ env, req }) => {
    await admin(env, req);
    const [sum, last] = await Promise.all([
      env.DB.prepare('SELECT status, COUNT(*) n FROM email_queue GROUP BY status').all(),
      env.DB.prepare(`SELECT q.id, q.kind, q.status, q.error, q.attempts, q.created_at, q.sent_at, a.full_name, q.to_email
        FROM email_queue q JOIN associates a ON a.id = q.associate_id ORDER BY q.id DESC LIMIT 100`).all(),
    ]);
    return json({ summary: Object.fromEntries(sum.results.map((r) => [r.status, r.n])), items: last.results, configured: mailConfigured(env) });
  }],
  ['POST', /^\/api\/emails\/retry$/, async ({ env, req, ctx }) => {
    await admin(env, req);
    const r = await env.DB.prepare(`UPDATE email_queue SET status = 'pending', attempts = 0, error = NULL WHERE status = 'failed' AND error NOT LIKE 'Adresse email invalide%'`).run();
    if (mailConfigured(env)) ctx.waitUntil(drainQueue(env, 100));
    return json({ ok: true, requeued: r.meta.changes || 0 });
  }],

  ['GET', /^\/api\/links$/, async ({ env, req }) => {
    await admin(env, req);
    const { results } = await env.DB.prepare(`SELECT a.ref, a.full_name, a.email, a.phone, a.employer, s.name tc, a.token FROM associates a LEFT JOIN staff s ON s.id = a.tc_id WHERE a.active = 1 ORDER BY a.ref`).all();
    const rows = [['Réf', 'Nom et prénom', 'Email', 'Téléphone', 'Entreprise', 'TC', 'Lien personnel', 'Lien WhatsApp'],
      ...results.map((r) => {
        const link = `${env.APP_URL}/a/${r.token}`;
        const msg = `Bonjour ${r.full_name}, merci de renseigner la réception de vos stipends (2 min) via votre lien personnel : ${link}`;
        return [r.ref, r.full_name, r.email, r.phone, r.employer, r.tc, link, r.phone ? `https://wa.me/${r.phone}?text=${encodeURIComponent(msg)}` : ''];
      })];
    return csvResponse(toCSV(rows), `liens-personnels-${today()}.csv`);
  }],

  // ---------- Équipe (TC / admins) ----------
  ['GET', /^\/api\/staff$/, async ({ env, req }) => {
    await admin(env, req);
    const { results } = await env.DB.prepare(
      `SELECT s.id, s.email, s.name, s.role, s.active, (SELECT COUNT(*) FROM associates a WHERE a.tc_id = s.id AND a.active = 1) AS associates FROM staff s ORDER BY s.role, s.name`
    ).all();
    return json({ items: results });
  }],
  ['POST', /^\/api\/staff$/, async ({ env, req, body }) => {
    const u = await admin(env, req);
    const items = (body.items || [body]).slice(0, 200).map((i) => ({
      email: String(i.email || '').trim().toLowerCase(), name: String(i.name || '').trim().slice(0, 120), role: i.role === 'admin' ? 'admin' : 'tc',
    })).filter((i) => isEmail(i.email) && i.name);
    if (!items.length) fail(400, 'Nom et email valides requis');
    const r = await env.DB.prepare(
      `INSERT INTO staff (email, name, role) SELECT json_extract(value,'$.email'), json_extract(value,'$.name'), json_extract(value,'$.role') FROM json_each(?) WHERE true
       ON CONFLICT (email) DO UPDATE SET name = excluded.name, role = excluded.role, active = 1`
    ).bind(JSON.stringify(items)).run();
    await logEvent(env, null, `staff:${u.email}`, 'staff_added', null, { count: items.length });
    return json({ ok: true, count: r.meta.changes || 0 });
  }],
  ['PATCH', /^\/api\/staff\/(\d+)$/, async ({ env, req, m, body }) => {
    const u = await admin(env, req);
    const id = Number(m[1]);
    if (id === u.id && body.active === false) fail(400, 'Vous ne pouvez pas désactiver votre propre compte.');
    const f = {};
    if (body.name) f.name = String(body.name).trim().slice(0, 120);
    if (body.role && id !== u.id) f.role = body.role === 'admin' ? 'admin' : 'tc';
    if ('active' in body) f.active = body.active ? 1 : 0;
    const keys = Object.keys(f);
    if (!keys.length) fail(400, 'Rien à modifier');
    await env.DB.prepare(`UPDATE staff SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...keys.map((k) => f[k]), id).run();
    if (f.active === 0) await env.DB.prepare('DELETE FROM sessions WHERE staff_id = ?').bind(id).run();
    return json({ ok: true });
  }],

  // ---------- Paramètres ----------
  ['GET', /^\/api\/settings$/, async ({ env, req }) => {
    await admin(env, req);
    const s = await getSettings(env);
    const sig = await env.FILES.head('settings/signatory.png');
    return json({ settings: s, has_signature: !!sig, mail_configured: mailConfigured(env), app_url: env.APP_URL, mail_from: env.MAIL_FROM });
  }],
  ['PUT', /^\/api\/settings$/, async ({ env, req, body }) => {
    const u = await admin(env, req);
    const out = [];
    for (const [k, v0] of Object.entries(body)) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      let v = String(v0 ?? '').trim().slice(0, k === 'tc_names' ? 4000 : 200);
      if (k === 'tc_names') v = tcOptions({ tc_names: v }).join('\n');
      if (k === 'program_start' && !isMonth(v)) fail(400, 'Mois de début invalide (AAAA-MM)');
      if (k === 'deadline' && v && !isDate(v)) fail(400, 'Date limite invalide');
      if (k === 'reminder_day' && !(+v >= 1 && +v <= 28)) fail(400, 'Jour d\'envoi : entre 1 et 28');
      if (k === 'reminder_offsets' && !/^\d{1,2}(,\d{1,2})*$/.test(v)) fail(400, 'Relances : jours séparés par des virgules (ex. 3,5)');
      if (k === 'attestation_months' && !(+v >= 1 && +v <= 12)) fail(400, 'Nombre de mois : 1 à 12');
      out.push(env.DB.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(k, v));
    }
    if (out.length) await env.DB.batch(out);
    await logEvent(env, null, `staff:${u.email}`, 'settings_updated', null, { keys: Object.keys(body) });
    return json({ ok: true });
  }],
  ['POST', /^\/api\/settings\/signature$/, async ({ env, req }) => {
    const u = await admin(env, req);
    const file = (await req.formData()).get('file');
    if (!file || typeof file === 'string' || file.size > 300_000) fail(400, 'Image PNG requise (300 Ko max).');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (sniffMime(bytes) !== 'image/png') fail(415, 'Format PNG requis (fond transparent recommandé).');
    await env.FILES.put('settings/signatory.png', bytes, { httpMetadata: { contentType: 'image/png' } });
    await logEvent(env, null, `staff:${u.email}`, 'signatory_signature_updated');
    return json({ ok: true });
  }],
  ['GET', /^\/api\/settings\/signature$/, async ({ env, req }) => {
    await staffAny(env, req);
    return serveR2(env, 'settings/signatory.png', 'image/png', 'signature.png');
  }],

  ['GET', /^\/api\/audit$/, async ({ env, req, url }) => {
    await admin(env, req);
    const type = url.searchParams.get('type');
    const { results } = await env.DB.prepare(
      `SELECT e.id, e.actor, e.type, e.month, e.data, e.created_at, a.full_name, a.ref FROM events e LEFT JOIN associates a ON a.id = e.associate_id
       ${type ? 'WHERE e.type = ?' : "WHERE e.type <> 'month_saved'"} ORDER BY e.id DESC LIMIT 200`
    ).bind(...(type ? [type] : [])).all();
    return json({ items: results.map((e) => ({ ...e, data: e.data ? JSON.parse(e.data) : null })) });
  }],

  ['POST', /^\/api\/backup$/, async ({ env, req }) => {
    await admin(env, req);
    return json({ ok: true, ...(await backupToR2(env)) });
  }],
];

function csvResponse(body, name) {
  return new Response(body, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' },
  });
}
