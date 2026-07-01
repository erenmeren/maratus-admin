// Pure HTML builders for the two customer-facing emails. HTML-escaped.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function button(href: string, label: string): string {
  // href is app-generated (not user input) so it is not escaped; label is static.
  return `<a href="${href}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#10A765;color:#fff;text-decoration:none;font-weight:600">${label}</a>`;
}

export function documentEmail(input: { orgName: string; documentUrl: string }): {
  subject: string;
  html: string;
} {
  const org = esc(input.orgName);
  return {
    subject: `Your document from ${input.orgName}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
<p>Here's your document from <strong>${org}</strong>.</p>
<p>${button(input.documentUrl, "View document")}</p>
<p style="color:#667085;font-size:13px">If you didn't request this, you can ignore this email.</p>
</div>`,
  };
}

export function lookupEmail(input: { orgName: string; recoveryUrl: string }): {
  subject: string;
  html: string;
} {
  const org = esc(input.orgName);
  return {
    subject: `Find your documents from ${input.orgName}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
<p>Use the button below to see the documents you've saved from <strong>${org}</strong>. This link expires in 30 minutes.</p>
<p>${button(input.recoveryUrl, "View my documents")}</p>
<p style="color:#667085;font-size:13px">If you didn't request this, you can ignore this email.</p>
</div>`,
  };
}
