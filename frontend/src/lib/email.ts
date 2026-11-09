import "server-only";

/**
 * Transactional email for Better Auth (password reset, email verification) through Resend.
 * Without RESEND_API_KEY the message is printed to the server console, so local dev needs no setup.
 * Same look as backend/app/email.py.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderEmail(title: string, paragraphs: string[], button?: { label: string; url: string }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.6;color:#3b3554">${esc(p)}</p>`).join("");
  const cta = button
    ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#705cbb;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;display:inline-block">${esc(button.label)}</a></p>` +
      `<p style="margin:0 0 14px;font-size:12px;color:#8f86b3">Or paste this link into your browser:<br>${esc(button.url)}</p>`
    : "";
  return (
    `<!doctype html><html><body style="margin:0;background:#f5f2ff;font-family:Segoe UI,Helvetica,Arial,sans-serif">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px"><tr><td>` +
    `<p style="margin:0 0 20px;font-weight:700;font-size:18px;color:#705cbb">vyuham</p>` +
    `<h1 style="margin:0 0 16px;font-size:22px;color:#110e22">${esc(title)}</h1>${body}${cta}` +
    `<p style="margin:24px 0 0;font-size:12px;color:#8f86b3">If you didn't ask for this, you can ignore this email.</p>` +
    `</td></tr></table></td></tr></table></body></html>`
  );
}

export async function sendEmail(to: string, subject: string, html: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(`[email:log-only] to=${to} subject=${subject}\n${text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "Vyuham <onboarding@resend.dev>", to: [to], subject, html, text }),
  });
  if (!res.ok) console.error(`[email] Resend refused a message to ${to}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}
