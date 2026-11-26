// lib/billing/invoice-emails.ts
// Generic transactional-email helpers, now that the invoice-specific email
// builders (invoiceSentEmail/paymentFailedEmail/paidReceiptEmail/
// overdueReminderEmail) are gone along with the invoice-enforcement flow.
// escapeHtml/emailLayout and the body blocks (emailEyebrow/emailHeading/
// emailText/emailButton/emailFallback/emailDetails/emailNote) are shared by
// every outgoing mail —
// lib/auth-emails.ts, lib/alerts.ts, lib/devices/device-emails.ts,
// lib/registry-emails.ts; getOrgEmailContext is the one IO helper,
// resolving org owner email + org name. Org names are user-controlled, so
// escapeHtml() guards every interpolation.

import { db } from "@/lib/db";
import { member, user, organization } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const BRAND = "Maratus";

// Visual language is direction 1g, light only (mail clients): near-white page,
// one white panel with a hairline and 12px corners, near-black text, muted
// secondary text, and the Peek orange on the primary button alone (white on
// #c2461f is 5.01:1). No glass, no gradients, no background images, no web
// font: Gabarito is named first for the heading and falls back to the system
// stack wherever it isn't installed. Every style is inline — Gmail/Outlook
// drop or rewrite <style> — the <style> block only carries the mobile
// overrides that clients honouring it can use.
//
// Dark mode: the mail declares itself light-only. Clients that recolour
// anyway (Gmail app, Outlook) darken the panel, so the lockup PNG is not
// transparent — it carries its own white rounded plate and stays legible.
//
// Email clients don't render SVG, so the lockup ships as a 3× PNG in
// public/email (rendered from the brand SVG). Always the production origin —
// a localhost BETTER_AUTH_URL would give a broken image in a real inbox.
// public/email/maratus-logo-light.png is the previous header's wordmark; it
// stays on disk because mail already delivered still points at it.
const SITE = "https://maratus.co";
const LOGO = "https://console.maratus.co/email/maratus-lockup.png";

const INK = "#171717";
const MUTED = "#5e5e5e";
const PAGE = "#fafafa";
const PANEL = "#ffffff";
const RULE = "#e8e8e8";
const ACCENT = "#c2461f";
const ON_ACCENT = "#ffffff";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DISPLAY = `Gabarito,${SANS}`;
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace";

/** Muted secondary colour, for callers that build their own inline spans. */
export const EMAIL_MUTED = MUTED;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Body building blocks ─────────────────────────────────────────────────────
// Callers pass already-escaped HTML — these helpers never escape for you.

/** Small muted label above the headline. */
export function emailEyebrow(html: string): string {
  return `<p style="margin:0 0 10px;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">${html}</p>`;
}

/** Tail of a headline: `Welcome ${emailAccent("aboard.")}`. Direction 1g sets
 * the whole headline in one face, so this no longer restyles anything — it
 * stays so callers keep marking which words are the tail. */
export function emailAccent(html: string): string {
  return html;
}

export function emailHeading(html: string): string {
  return `<h1 class="h1" style="margin:0 0 14px;font-family:${DISPLAY};font-size:28px;line-height:34px;font-weight:600;letter-spacing:-0.5px;color:${INK};mso-line-height-rule:exactly">${html}</h1>`;
}

export function emailText(html: string): string {
  return `<p style="margin:0 0 20px;font-family:${SANS};font-size:15px;line-height:24px;color:${INK};mso-line-height-rule:exactly">${html}</p>`;
}

/** Inline emphasis inside emailText (names, org names, addresses). */
export function emailStrong(html: string): string {
  return `<strong style="font-weight:600;color:${INK}">${html}</strong>`;
}

/** Muted small print right under the button (expiry etc.). */
export function emailNote(html: string): string {
  return `<p style="margin:0 0 8px;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">${html}</p>`;
}

/** Bulletproof orange button, 6px corners (VML fallback for Outlook). */
export function emailButton(href: string, label: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px"><tr>` +
    `<td bgcolor="${ACCENT}" style="background:${ACCENT};border-radius:6px">` +
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${href}" style="height:44px;v-text-anchor:middle;width:240px" arcsize="14%" stroke="f" fillcolor="${ACCENT}"><center style="color:${ON_ACCENT};font-family:Arial,sans-serif;font-size:15px;font-weight:bold">${label}</center></v:roundrect><![endif]-->` +
    `<!--[if !mso]><!--><a href="${href}" target="_blank" style="display:block;white-space:nowrap;padding:12px 22px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;color:${ON_ACCENT};text-decoration:none;border-radius:6px">${label} &rarr;</a><!--<![endif]-->` +
    `</td></tr></table>`
  );
}

/** Ruled closing block: the copyable fallback link (buttons get stripped by
 * some clients and by forwarding) and/or a "not expecting this?" line. */
export function emailFallback(opts: { href?: string; ignore?: string }): string {
  const link = opts.href
    ? `<p style="margin:0 0 8px;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">Button not working? Paste this link into your browser:</p>` +
      `<p style="margin:0 0 16px;font-family:${MONO};font-size:12px;line-height:18px;word-break:break-all"><a href="${opts.href}" target="_blank" style="color:${INK};text-decoration:underline">${opts.href}</a></p>`
    : "";
  const ignore = opts.ignore
    ? `<p style="margin:0;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">${opts.ignore}</p>`
    : "";
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px"><tr>` +
    `<td style="border-top:1px solid ${RULE};padding-top:20px">${link}${ignore}</td>` +
    `</tr></table>`
  );
}

/** Label/value rows between hairlines — device lists, claim details, etc. */
export function emailDetails(rows: { label: string; value: string }[]): string {
  const cells = rows
    .map(
      (r, i) =>
        `<tr><td style="border-top:1px solid ${RULE};${i === rows.length - 1 ? `border-bottom:1px solid ${RULE};` : ""}padding:12px 0">` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
        `<td width="130" valign="top" style="padding-right:12px;font-family:${SANS};font-size:13px;line-height:22px;color:${MUTED}">${r.label}</td>` +
        `<td valign="top" style="font-family:${SANS};font-size:15px;line-height:22px;color:${INK};word-break:break-word">${r.value}</td>` +
        `</tr></table></td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px">${cells}</table>`;
}

/** Wrap a body fragment in the shared branded shell. `preheader` is the inbox
 * preview line; `title` becomes the document <title>. */
export function emailLayout(
  bodyHtml: string,
  opts: { preheader?: string; title?: string } = {},
): string {
  const preheader = opts.preheader
    ? `<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px">${opts.preheader}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</span>`
    : "";
  const footLink = `color:${INK};text-decoration:underline`;
  return (
    `<!DOCTYPE html><html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge">` +
    `<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">` +
    `<title>${opts.title ?? BRAND}</title>` +
    `<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><style>h1,p,td,a{font-family:Arial,sans-serif!important}</style><![endif]-->` +
    `<style>` +
    `:root{color-scheme:light only}` +
    `body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}` +
    `table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}` +
    `img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}` +
    `a{color:${INK}}` +
    `@media only screen and (max-width:620px){.container{width:100%!important}.px{padding-left:24px!important;padding-right:24px!important}.logo{padding-left:16px!important;padding-right:16px!important}.h1{font-size:24px!important;line-height:30px!important}}` +
    `</style></head>` +
    `<body style="margin:0;padding:0;background:${PAGE}">` +
    preheader +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE}" style="background:${PAGE}"><tr>` +
    `<td align="center" style="padding:32px 12px">` +
    `<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->` +
    `<table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="${PANEL}" style="width:560px;max-width:560px;background:${PANEL};border:1px solid ${RULE};border-radius:12px;border-collapse:separate">` +
    // logo: the PNG is the lockup on its own white plate, 8px of plate all round
    `<tr><td class="logo" style="padding:24px 32px 0">` +
    `<a href="${SITE}/" target="_blank" style="text-decoration:none"><img src="${LOGO}" width="148" height="40" alt="${BRAND}" style="display:block;width:148px;height:40px;color:${INK};font-family:${SANS};font-size:20px;line-height:40px;font-weight:600"></a>` +
    `</td></tr>` +
    // body
    `<tr><td class="px" style="padding:20px 40px 28px">` +
    bodyHtml +
    `</td></tr>` +
    // footer, behind a hairline
    `<tr><td class="px" style="padding:0 40px 28px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${RULE};padding-top:20px">` +
    `<p style="margin:0 0 6px;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">Small screen. Better goodbye.</p>` +
    `<p style="margin:0;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">` +
    `<a href="mailto:hi@maratus.co" style="${footLink}">hi@maratus.co</a> &nbsp;&middot;&nbsp; ` +
    `<a href="${SITE}/" target="_blank" style="${footLink}">maratus.co</a> &nbsp;&middot;&nbsp; ` +
    `<a href="https://console.maratus.co/" target="_blank" style="${footLink}">Console</a>` +
    `</p></td></tr></table>` +
    `</td></tr>` +
    `</table>` +
    `<!--[if mso]></td></tr></table><![endif]-->` +
    `</td></tr></table></body></html>`
  );
}

/** Owner, else an admin, else a plain member. Scoped roles (designer,
 *  operations, billing, developer) never receive org-wide mail. */
export function pickOrgContact<T extends { role: string }>(rows: T[]): T | null {
  return (
    rows.find((r) => r.role === "owner") ??
    rows.find((r) => r.role === "admin") ??
    rows.find((r) => r.role === "member") ??
    null
  );
}

/** Resolve the org owner's email (fallback: admin, then member) + the org name, for
 * addressing/personalising a transition email. ownerEmail is null when the org
 * has no owner, admin or member. */
export async function getOrgEmailContext(
  organizationId: string,
): Promise<{ ownerEmail: string | null; orgName: string }> {
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  const rows = await db
    .select({ email: user.email, role: member.role })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, organizationId));

  const owner = pickOrgContact(rows);
  return { ownerEmail: owner?.email ?? null, orgName: org?.name ?? "your organization" };
}
