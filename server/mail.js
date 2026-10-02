import nodemailer from 'nodemailer';
import { db } from './db.js';
import { onNotify } from './lib.js';

/*
 * Mail opcional. Se activa con las variables SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS y MAIL_FROM
 * (y APP_URL para los links). Sin ellas, los avisos quedan solo dentro de la app.
 */
const enabled = !!process.env.SMTP_HOST;
const transport = enabled ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
}) : null;

export const mailEnabled = () => enabled;
export const appUrl = (path = '') => `${(process.env.APP_URL || 'http://localhost:4310').replace(/\/$/, '')}${path}`;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function sendMail(to, subject, text, link) {
  if (!enabled || !to?.length) return false;
  const html = `<div style="font-family:Georgia,serif;color:#1d1b18;max-width:520px">
    <div style="font-size:28px;letter-spacing:-.5px">MAJA<span style="color:#7c2d23">.</span></div>
    <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:bold;margin:24px 0 8px">${esc(subject)}</p>
    ${text ? `<p style="font-family:Arial,sans-serif;font-size:14px;color:#4a453e;margin:0 0 16px">${esc(text)}</p>` : ''}
    ${link ? `<a href="${esc(appUrl(link))}" style="display:inline-block;background:#1d1b18;color:#f4f0e8;padding:10px 18px;border-radius:6px;font-family:Arial,sans-serif;font-size:14px;text-decoration:none">Abrir en MAJA</a>` : ''}
  </div>`;
  await transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text: [text, link && appUrl(link)].filter(Boolean).join('\n\n'), html });
  return true;
}

// los avisos a la marca y a la dueña también salen por mail (los de la tienda quedan en la app)
onNotify(({ audience, brandId, title, body, link }) => {
  if (!enabled) return;
  let to = [];
  if (audience === 'brand') {
    to = db.prepare("SELECT email FROM users WHERE role = 'marca' AND active = 1 AND brand_id = ?").all(brandId).map((u) => u.email);
  } else if (audience === 'owner') {
    to = db.prepare("SELECT email FROM users WHERE role = 'admin' AND active = 1").all().map((u) => u.email);
  }
  sendMail(to, title, body, link).catch((e) => console.error('[mail]', e.message));
});
