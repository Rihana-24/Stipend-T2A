import { fail, json, randToken, sha256Hex, nowISO, timingSafeEqual, isEmail, logEvent } from './util.js';
import { sendOne, mailConfigured } from './mail.js';

const COOKIE = 't2a_session';
const SESSION_DAYS = 14;

const parseCookies = (req) =>
  Object.fromEntries((req.headers.get('cookie') || '').split(/;\s*/).filter(Boolean).map((c) => {
    const i = c.indexOf('=');
    return [c.slice(0, i), c.slice(i + 1)];
  }));

const adminEmails = (env) => (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

export async function currentUser(env, req) {
  const tok = parseCookies(req)[COOKIE];
  if (!tok) return null;
  const row = await env.DB.prepare(
    `SELECT s.id, s.email, s.name, s.role FROM sessions x JOIN staff s ON s.id = x.staff_id
     WHERE x.token_hash = ? AND x.expires_at > ? AND s.active = 1`
  ).bind(await sha256Hex(tok), nowISO()).first();
  return row || null;
}

export async function requireUser(env, req, roles = ['admin', 'tc']) {
  const u = await currentUser(env, req);
  if (!u) fail(401, 'Connexion requise');
  if (!roles.includes(u.role)) fail(403, 'Accès refusé');
  return u;
}

async function findOrCreateStaff(env, email) {
  email = email.trim().toLowerCase();
  let st = await env.DB.prepare('SELECT * FROM staff WHERE email = ?').bind(email).first();
  if (!st && adminEmails(env).includes(email)) {
    await env.DB.prepare(`INSERT INTO staff (email, name, role) VALUES (?, ?, 'admin')`).bind(email, email.split('@')[0]).run();
    st = await env.DB.prepare('SELECT * FROM staff WHERE email = ?').bind(email).first();
  }
  return st && st.active ? st : null;
}

async function startSession(env, req, staff) {
  const tok = randToken(32);
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token_hash, staff_id, expires_at, created_at) VALUES (?,?,?,?)')
    .bind(await sha256Hex(tok), staff.id, exp, nowISO()).run();
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export const authRoutes = [
  ['GET', /^\/api\/auth\/config$/, async ({ env }) =>
    json({ email: mailConfigured(env), password: Boolean(env.ADMIN_PASSWORD), dev: env.DEV_LOGIN_LINKS === '1' })],

  // Demande de lien magique : réponse identique que le compte existe ou non (pas d'énumération).
  ['POST', /^\/api\/auth\/request$/, async ({ env, req, body }) => {
    const email = String(body.email || '').trim().toLowerCase();
    if (!isEmail(email)) fail(400, 'Adresse email invalide');
    const st = await findOrCreateStaff(env, email);
    const out = { ok: true };
    if (st) {
      const recent = await env.DB.prepare('SELECT COUNT(*) n FROM login_tokens WHERE staff_id = ? AND created_at > ?')
        .bind(st.id, new Date(Date.now() - 3600e3).toISOString()).first();
      if (recent.n < 5) {
        const tok = randToken(32);
        await env.DB.prepare('INSERT INTO login_tokens (token_hash, staff_id, expires_at, created_at) VALUES (?,?,?,?)')
          .bind(await sha256Hex(tok), st.id, new Date(Date.now() + 20 * 60e3).toISOString(), nowISO()).run();
        const link = `${env.APP_URL}/staff?t=${tok}`;
        if (env.DEV_LOGIN_LINKS === '1') out.dev_link = link;
        else {
          try {
            await sendOne(env, st.email, 'Votre lien de connexion – Suivi des stipends',
              `<p>Bonjour ${st.name},</p><p>Cliquez pour vous connecter (valable 20 minutes, usage unique) :</p><p><a href="${link}" style="background:#1f6a52;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Me connecter</a></p><p style="font-size:12px;color:#666">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`);
          } catch (e) { console.error('login mail', e.message); }
        }
      }
    }
    return json(out);
  }],

  ['POST', /^\/api\/auth\/verify$/, async ({ env, req, body }) => {
    const h = await sha256Hex(String(body.token || ''));
    const row = await env.DB.prepare('SELECT * FROM login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').bind(h, nowISO()).first();
    if (!row) fail(400, 'Lien expiré ou déjà utilisé. Demandez un nouveau lien.');
    await env.DB.prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ?').bind(nowISO(), h).run();
    const st = await env.DB.prepare('SELECT * FROM staff WHERE id = ? AND active = 1').bind(row.staff_id).first();
    if (!st) fail(403, 'Compte désactivé');
    const cookie = await startSession(env, req, st);
    await logEvent(env, null, `staff:${st.email}`, 'login');
    return json({ ok: true, user: { name: st.name, email: st.email, role: st.role } }, 200, { 'set-cookie': cookie });
  }],

  // Secours administrateur : mot de passe défini via `wrangler secret put ADMIN_PASSWORD` (adresses de ADMIN_EMAILS uniquement).
  ['POST', /^\/api\/auth\/password$/, async ({ env, req, body }) => {
    const email = String(body.email || '').trim().toLowerCase();
    if (!env.ADMIN_PASSWORD || !adminEmails(env).includes(email) || !timingSafeEqual(body.password || '', env.ADMIN_PASSWORD))
      fail(401, 'Identifiants incorrects');
    const st = await findOrCreateStaff(env, email);
    if (!st) fail(401, 'Identifiants incorrects');
    return json({ ok: true }, 200, { 'set-cookie': await startSession(env, req, st) });
  }],

  ['POST', /^\/api\/auth\/logout$/, async ({ env, req }) => {
    const tok = parseCookies(req)[COOKIE];
    if (tok) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(tok)).run();
    return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
  }],

  ['GET', /^\/api\/me$/, async ({ env, req }) => {
    const u = await currentUser(env, req);
    return json({ user: u });
  }],
];
