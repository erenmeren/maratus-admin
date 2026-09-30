// The public API docs are served by this same deployment on their own host:
// docs.maratus.co/ is rewritten to /docs (next.config.ts), and the console
// sections (/admin, /tenant) are bounced back to console.maratus.co there.
export const DOCS_HOST = "docs.maratus.co";
export const CONSOLE_ORIGIN = "https://console.maratus.co";

export function isDocsHost(host: string | null | undefined): boolean {
  return (host ?? "").toLowerCase().split(":")[0] === DOCS_HOST;
}
