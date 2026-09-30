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

// Visual language follows the "Maratus Email" designs (claude.ai/design): ink
// header + footer, paper card, Courier eyebrow, big headline with an italic
// serif accent, lime pill CTA, light/dark aware. Every style is inline —
// Gmail/Outlook drop or rewrite <style> — the <style> block only carries the
// mobile + dark-mode overrides that clients honouring it can use.
//
// Email clients don't render SVG, so the wordmark ships as a 3× PNG in
// public/email (rendered from the brand SVG). Always the production origin —
// a localhost BETTER_AUTH_URL would give a broken image in a real inbox.
const SITE = "https://maratus.co";
const LOGO = "https://console.maratus.co/email/maratus-logo-light.png";

const INK = "#191820";
const PAPER = "#f9f8fc";
const LIME = "#d5fa58";
const PAGE = "#eeedf3";
const BODY = "#56546a";
const MUTED = "#6b6980";
const RULE = "#dddbe6";
const SANS = "Helvetica,Arial,sans-serif";
const MONO = "'Courier New',Courier,monospace";
const SERIF = "Georgia,'Times New Roman',serif";

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

/** Small uppercase monospace label above the headline. */
export function emailEyebrow(html: string): string {
  return `<p class="muted" style="margin:0 0 14px;font-family:${MONO};font-size:12px;line-height:16px;letter-spacing:1.5px;color:${MUTED};text-transform:uppercase">${html}</p>`;
}

/** Italic serif accent for the tail of a headline: `Welcome ${emailAccent("aboard.")}`. */
export function emailAccent(html: string): string {
  return `<span style="font-family:${SERIF};font-style:italic;font-weight:normal">${html}</span>`;
}

export function emailHeading(html: string): string {
  return `<h1 class="h1 ink" style="margin:0 0 16px;font-family:${SANS};font-size:36px;line-height:40px;font-weight:bold;letter-spacing:-1.2px;color:${INK};mso-line-height-rule:exactly">${html}</h1>`;
}

export function emailText(html: string): string {
  return `<p class="muted" style="margin:0 0 20px;font-family:${SANS};font-size:16px;line-height:25px;color:${BODY};mso-line-height-rule:exactly">${html}</p>`;
}

/** Inline emphasis inside emailText (names, org names, addresses). */
export function emailStrong(html: string): string {
  return `<strong class="ink" style="color:${INK}">${html}</strong>`;
}

/** Monospace small print right under the button (expiry etc.). */
export function emailNote(html: string): string {
  return `<p class="muted" style="margin:0 0 8px;font-family:${MONO};font-size:12px;line-height:18px;color:${MUTED}">${html}</p>`;
}

/** Bulletproof lime pill button (VML fallback for Outlook). */
export function emailButton(href: string, label: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 18px"><tr>` +
    `<td bgcolor="${LIME}" style="background:${LIME};border-radius:999px">` +
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${href}" style="height:50px;v-text-anchor:middle;width:260px" arcsize="50%" stroke="f" fillcolor="${LIME}"><center style="color:${INK};font-family:Arial,sans-serif;font-size:16px;font-weight:bold">${label}</center></v:roundrect><![endif]-->` +
    `<!--[if !mso]><!--><a href="${href}" target="_blank" style="display:block;white-space:nowrap;padding:16px 32px;font-family:${SANS};font-size:16px;line-height:18px;font-weight:bold;color:${INK};text-decoration:none;border-radius:999px">${label} &rarr;</a><!--<![endif]-->` +
    `</td></tr></table>`
  );
}

/** Ruled closing block: the copyable fallback link (buttons get stripped by
 * some clients and by forwarding) and/or a "not expecting this?" line. */
export function emailFallback(opts: { href?: string; ignore?: string }): string {
  const link = opts.href
    ? `<p class="muted" style="margin:0 0 10px;font-family:${SANS};font-size:13px;line-height:20px;color:${BODY}">Button not working? Paste this link into your browser:</p>` +
      `<p style="margin:0 0 18px;font-family:${MONO};font-size:12px;line-height:18px;word-break:break-all"><a href="${opts.href}" target="_blank" class="ink" style="color:${INK};text-decoration:underline">${opts.href}</a></p>`
    : "";
  const ignore = opts.ignore
    ? `<p class="muted" style="margin:0;font-family:${SANS};font-size:13px;line-height:20px;color:${BODY}">${opts.ignore}</p>`
    : "";
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px"><tr>` +
    `<td class="rule" style="border-top:1px solid ${RULE};padding-top:20px">${link}${ignore}</td>` +
    `</tr></table>`
  );
}

/** Label/value rows between hairlines — device lists, claim details, etc. */
export function emailDetails(rows: { label: string; value: string }[]): string {
  const cells = rows
    .map(
      (r, i) =>
        `<tr><td class="rule" style="border-top:1px solid ${RULE};${i === rows.length - 1 ? `border-bottom:1px solid ${RULE};` : ""}padding:14px 0">` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
        `<td width="130" valign="top" class="muted" style="font-family:${MONO};font-size:12px;line-height:22px;letter-spacing:0.5px;color:${MUTED};text-transform:uppercase">${r.label}</td>` +
        `<td valign="top" class="ink" style="font-family:${SANS};font-size:15px;line-height:22px;color:${INK}">${r.value}</td>` +
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
  return (
    `<!DOCTYPE html><html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge">` +
    `<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">` +
    `<title>${opts.title ?? BRAND}</title>` +
    `<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->` +
    `<style>` +
    `body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}` +
    `table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}` +
    `img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}` +
    `a{color:${INK}}` +
    `@media only screen and (max-width:620px){.container{width:100%!important}.px{padding-left:24px!important;padding-right:24px!important}.h1{font-size:30px!important;line-height:34px!important}}` +
    `@media (prefers-color-scheme:dark){.bg-page{background:#101015!important}.bg-card{background:#1f1e27!important}.ink{color:${PAPER}!important}.muted{color:#b9b7c6!important}.rule{border-color:#34323f!important}}` +
    `</style></head>` +
    `<body class="bg-page" style="margin:0;padding:0;background:${PAGE}">` +
    preheader +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-page" style="background:${PAGE}"><tr>` +
    `<td align="center" style="padding:40px 12px">` +
    `<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->` +
    `<table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px">` +
    // header
    `<tr><td bgcolor="${INK}" class="px" style="background:${INK};padding:26px 40px;border-radius:16px 16px 0 0">` +
    `<a href="${SITE}/" target="_blank" style="text-decoration:none"><img src="${LOGO}" width="116" height="24" alt="maratus." style="display:block;width:116px;height:24px;color:${PAPER};font-family:${SANS};font-size:22px;font-weight:bold"></a>` +
    `</td></tr>` +
    // card
    `<tr><td bgcolor="${PAPER}" class="px bg-card" style="background:${PAPER};padding:44px 40px 40px">` +
    bodyHtml +
    `</td></tr>` +
    // footer
    `<tr><td bgcolor="${INK}" class="px" style="background:${INK};padding:28px 40px;border-radius:0 0 16px 16px">` +
    `<p style="margin:0 0 16px;font-family:${SERIF};font-style:italic;font-size:14px;line-height:20px;color:#c9c7d6">Small screen. Better goodbye.</p>` +
    `<p style="margin:0;font-family:${SANS};font-size:12px;line-height:19px;color:#a9a7b8">` +
    `<a href="mailto:hi@maratus.co" style="color:${PAPER};text-decoration:underline">hi@maratus.co</a> &nbsp;&middot;&nbsp; ` +
    `<a href="${SITE}/" target="_blank" style="color:${PAPER};text-decoration:underline">maratus.co</a> &nbsp;&middot;&nbsp; ` +
    `<a href="https://console.maratus.co/" target="_blank" style="color:${PAPER};text-decoration:underline">Console</a>` +
    `</p></td></tr>` +
    `</table>` +
    `<!--[if mso]></td></tr></table><![endif]-->` +
    `</td></tr></table></body></html>`
  );
}

/** Resolve the org owner's email (fallback: any member) + the org name, for
 * addressing/personalising a transition email. ownerEmail is null when the org
 * has no members. */
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

  const owner = rows.find((r) => r.role === "owner") ?? rows[0] ?? null;
  return { ownerEmail: owner?.email ?? null, orgName: org?.name ?? "your organization" };
}
