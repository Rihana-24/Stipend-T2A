import { HttpError, json, getSettings, today, currentMonth } from './util.js';
import { authRoutes } from './auth.js';
import { associateRoutes } from './associate.js';
import { staffRoutes, enqueue, backupToR2 } from './staff.js';
import { drainQueue, notifyTCs } from './mail.js';

// Ordre important : les routes spécifiques (/api/a/resend, /api/associates/assign…) passent avant les routes à paramètre.
const routes = [...authRoutes, ...associateRoutes, ...staffRoutes.filter((r) => /assign|import/.test(String(r[1]))), ...staffRoutes.filter((r) => !/assign|import/.test(String(r[1])))];

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        // Anti-CSRF : un formulaire tiers ne peut pas poser cet en-tête personnalisé.
        if (req.headers.get('x-requested-with') !== 't2a') throw new HttpError(403, 'Requête refusée');
      }
      for (const [method, re, handler] of routes) {
        if (req.method !== method) continue;
        const m = url.pathname.match(re);
        if (!m) continue;
        let body = {};
        if (method !== 'GET' && (req.headers.get('content-type') || '').includes('application/json')) {
          try { body = await req.json(); } catch { throw new HttpError(400, 'JSON invalide'); }
        }
        return await handler({ env, req, url, m, body, ctx });
      }
      throw new HttpError(404, 'Route inconnue');
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
      console.error(e);
      return json({ error: 'Erreur interne. Réessayez dans un instant.' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    // Toutes les 5 minutes : envoi des emails en attente.
    if (event.cron === '*/5 * * * *') {
      ctx.waitUntil(drainQueue(env, 100));
      return;
    }
    // Chaque jour 09:00 UTC : le 10 → invitation à tous ; jours de relance → relance des non-répondants + récap aux TC.
    const s = await getSettings(env);
    const day = new Date().getUTCDate();
    const base = parseInt(s.reminder_day, 10) || 10;
    const offsets = s.reminder_offsets.split(',').map((n) => parseInt(n, 10)).filter(Number.isFinite);
    const month = currentMonth();
    if (day === base) await enqueue(env, { kind: 'invite', period: month, target: 'all' });
    else if (offsets.some((o) => day === base + o)) {
      await enqueue(env, { kind: 'reminder', period: `${month}:d${day}`, target: 'nonresponders' });
      try { await notifyTCs(env); } catch (e) { console.error('notifyTCs', e.message); }
    }
    if (day === base + 1 || day === 1) await backupToR2(env);
    ctx.waitUntil(drainQueue(env, 100));
  },
};
