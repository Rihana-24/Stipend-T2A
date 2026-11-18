import { getSettings, monthLabel, currentMonth, nowISO, isEmail, prevMonth } from './util.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');

function layout(env, title, bodyHtml, cta) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f6f4;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#1c2b26">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
 <div style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e1e8e4">
  <div style="padding:20px 24px;border-bottom:1px solid #e8eeea"><img src="${esc(env.APP_URL)}/logo.png" alt="Mastercard Foundation · Associates Program · Talent2Africa" height="44" style="height:44px;max-width:100%"></div>
  <div style="padding:24px;line-height:1.55;font-size:15px">
   <h1 style="font-size:20px;margin:0 0 12px;color:#1f6a52">${esc(title)}</h1>
   ${bodyHtml}
   ${cta ? `<p style="margin:24px 0"><a href="${esc(cta.url)}" style="background:#1f6a52;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:600;display:inline-block">${esc(cta.label)}</a></p>
   <p style="font-size:12px;color:#6b7a73;word-break:break-all">Si le bouton ne fonctionne pas, copiez ce lien : ${esc(cta.url)}</p>` : ''}
  </div>
 </div>
 <p style="font-size:12px;color:#6b7a73;text-align:center;margin:16px 0 0">Ce lien est personnel : ne le partagez pas. Talent2Africa · Programme Associates</p>
</div></body></html>`;
}

export function buildMessage(env, s, row) {
  const link = `${env.APP_URL}/a/${row.token}`;
  const first = row.first_name || row.full_name;
  const deadline = s.deadline ? fmtDate(s.deadline) : '';
  const hi = `<p>Bonjour ${esc(first)},</p>`;
  switch (row.kind) {
    case 'reminder':
      return {
        subject: 'Rappel : confirmez la réception de vos stipends',
        html: layout(env, 'Un rappel rapide', `${hi}<p>Nous n'avons pas encore reçu toutes vos informations sur vos stipends (indemnités de stage).${deadline ? ` Merci de les compléter <b>avant le ${esc(deadline)}</b>.` : ''}</p><p>Cela prend environ 2 minutes depuis votre téléphone : montant reçu, date, photo du justificatif, puis votre signature.</p>`, { url: link, label: 'Compléter mes informations' }),
      };
    case 'dispute': {
      const p = row.payload ? JSON.parse(row.payload) : {};
      return {
        subject: `Correction demandée pour ${p.label || 'un mois'}`,
        html: layout(env, 'Une correction est nécessaire', `${hi}<p>Votre TalentCorps référent a demandé une correction pour <b>${esc(p.label || '')}</b> :</p><blockquote style="margin:12px 0;padding:10px 14px;background:#fff6e5;border-left:4px solid #f79e1b;border-radius:6px">${esc(p.comment || '')}</blockquote><p>Merci de mettre à jour l'information ou d'ajouter un justificatif.</p>`, { url: link, label: 'Corriger maintenant' }),
      };
    }
    case 'link':
      return {
        subject: 'Votre lien personnel – suivi des stipends',
        html: layout(env, 'Votre lien personnel', `${hi}<p>Voici votre lien personnel pour renseigner vos stipends et téléverser vos justificatifs.</p>`, { url: link, label: 'Ouvrir mon espace' }),
      };
    default: // invite
      return {
        subject: `Stipends : renseignez votre réception ${monthLabel(/^\d{4}-\d{2}/.test(row.period) ? row.period.slice(0, 7) : currentMonth())}`,
        html: layout(env, 'Suivi mensuel de vos stipends', `${hi}<p>Dans le cadre du Programme Associates (Mastercard Foundation · Talent2Africa), nous vérifions chaque mois la bonne réception des stipends (indemnités de stage).</p><p>Merci d'indiquer les mois pour lesquels vous avez été payé(e), le montant en FCFA, la date de réception, et d'ajouter la preuve (capture ou photo du virement).${deadline ? ` Date limite : <b>${esc(deadline)}</b>.` : ''}</p>`, { url: link, label: 'Renseigner mes stipends' }),
      };
  }
}

async function resendBatch(env, messages) {
  const res = await fetch(`${env.RESEND_URL || 'https://api.resend.com'}/emails/batch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

export async function sendOne(env, to, subject, html) {
  if (!env.RESEND_API_KEY) throw new Error("Envoi d'emails non configuré (RESEND_API_KEY manquant)");
  const res = await fetch(`${env.RESEND_URL || 'https://api.resend.com'}/emails`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export const mailConfigured = (env) => Boolean(env.RESEND_API_KEY);

// Vide la file par paquets (1 appel API = jusqu'à 100 emails) : respecte la limite de 50 sous-requêtes du plan gratuit.
export async function drainQueue(env, limit = 100) {
  if (!mailConfigured(env)) return { sent: 0, skipped: true };
  const { results } = await env.DB.prepare(
    `SELECT q.id, q.kind, q.period, q.payload, q.to_email, q.attempts, a.full_name, a.first_name, a.token
     FROM email_queue q JOIN associates a ON a.id = q.associate_id
     WHERE q.status = 'pending' ORDER BY q.id LIMIT ?`
  ).bind(limit).all();
  if (!results.length) return { sent: 0 };
  const s = await getSettings(env);
  const valid = results.filter((r) => isEmail(r.to_email));
  const invalid = results.filter((r) => !isEmail(r.to_email)).map((r) => r.id);
  if (invalid.length)
    await env.DB.prepare(`UPDATE email_queue SET status='failed', error='Adresse email invalide' WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(invalid)).run();
  if (!valid.length) return { sent: 0 };
  const ids = JSON.stringify(valid.map((r) => r.id));
  try {
    const messages = valid.map((r) => {
      const m = buildMessage(env, s, r);
      return { from: env.MAIL_FROM, to: [r.to_email], subject: m.subject, html: m.html };
    });
    await resendBatch(env, messages);
    await env.DB.prepare(`UPDATE email_queue SET status='sent', sent_at=?, error=NULL WHERE id IN (SELECT value FROM json_each(?))`).bind(nowISO(), ids).run();
    await env.DB.prepare(`UPDATE associates SET link_sent_at = ?, link_channel = 'email' WHERE id IN (SELECT associate_id FROM email_queue WHERE id IN (SELECT value FROM json_each(?)))`).bind(nowISO(), ids).run();
    return { sent: valid.length };
  } catch (e) {
    await env.DB.prepare(
      `UPDATE email_queue SET attempts = attempts + 1, error = ?, status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'pending' END WHERE id IN (SELECT value FROM json_each(?))`
    ).bind(String(e.message).slice(0, 300), ids).run();
    return { sent: 0, error: e.message };
  }
}

// Récapitulatif pour les TC : nombre de déclarations à valider.
export async function notifyTCs(env) {
  if (!mailConfigured(env)) return 0;
  const { results } = await env.DB.prepare(
    `SELECT s.email, s.name, COUNT(*) AS pending
     FROM stipend_months m JOIN associates a ON a.id = m.associate_id JOIN staff s ON s.id = a.tc_id
     WHERE m.declared = 'received' AND m.review = 'pending' AND s.active = 1 AND s.role IN ('tc','admin')
     GROUP BY s.id`
  ).all();
  if (!results.length) return 0;
  const messages = results.map((r) => ({
    from: env.MAIL_FROM,
    to: [r.email],
    subject: `${r.pending} déclaration(s) de stipend à confirmer`,
    html: layout(env, 'Des stipends attendent votre confirmation', `<p>Bonjour ${esc(r.name)},</p><p><b>${r.pending}</b> déclaration(s) de vos Associates sont en attente de confirmation. Vérifiez les justificatifs et confirmez ou demandez une correction.</p>`, { url: `${env.APP_URL}/staff`, label: 'Ouvrir mon espace TC' }),
  }));
  await resendBatch(env, messages);
  return results.length;
}

export const lastMonthKey = () => prevMonth(currentMonth());
