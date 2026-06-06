// Pure (IO-free) alert lifecycle reconciliation + email composition. The IO that
// drives this lives in lib/alerts-sync.ts; the alert RULES live in lib/health.ts
// (computeAlerts). This file only decides what changed and what to say.

import type { HealthAlert } from "./health";

/** The minimal shape of an open alert row, keyed for reconciliation. */
export interface OpenAlert {
  key: string;
  message: string;
}

export interface AlertDiff {
  toOpen: HealthAlert[]; // tripped now, not currently open → insert
  toResolve: OpenAlert[]; // open in DB, no longer tripped → resolve
  stillOpen: OpenAlert[]; // persist → refresh message/lastSeen
}

/** Reconcile freshly-computed alerts against the currently-open persisted rows.
 *  Precondition: `current` has unique `key`s (computeAlerts guarantees this). */
export function diffAlerts(current: HealthAlert[], open: OpenAlert[]): AlertDiff {
  const openByKey = new Map(open.map((o) => [o.key, o]));
  const currentKeys = new Set(current.map((a) => a.key));
  return {
    toOpen: current.filter((a) => !openByKey.has(a.key)),
    toResolve: open.filter((o) => !currentKeys.has(o.key)),
    stillOpen: current
      .filter((a) => openByKey.has(a.key))
      .map((a) => ({ key: a.key, message: a.message })),
  };
}

/** Escape user-controlled text (alert messages include tenant names) for HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Digest email for newly-opened alerts. null when there are none. */
export function alertEmail(
  newAlerts: HealthAlert[],
): { subject: string; html: string } | null {
  if (newAlerts.length === 0) return null;
  const subject = `⚠ Ditto: ${newAlerts.length} new health alert${newAlerts.length > 1 ? "s" : ""}`;
  const items = newAlerts
    .map((a) => `<li><strong>${a.severity.toUpperCase()}</strong>: ${escapeHtml(a.message)}</li>`)
    .join("");
  const html = `<p>New platform health alerts:</p><ul>${items}</ul>`;
  return { subject, html };
}
