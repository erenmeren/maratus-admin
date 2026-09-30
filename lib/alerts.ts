// Pure (IO-free) alert lifecycle reconciliation + email composition. The IO that
// drives this lives in lib/alerts-sync.ts; the alert RULES live in lib/health.ts
// (computeAlerts). This file only decides what changed and what to say.

import type { HealthAlert } from "./health";
import {
  emailAccent,
  emailButton,
  emailDetails,
  emailEyebrow,
  emailHeading,
  emailLayout,
  emailText,
  escapeHtml,
} from "./billing/invoice-emails";

/** The minimal shape of an open alert row, keyed for reconciliation. */
export interface OpenAlert {
  key: string;
  message: string;
}

/**
 * Key namespace for alerts raised by the billing cron. Reconciliation is
 * whole-set — anything open and not re-tripped gets resolved — so the health
 * sweep and the billing sweep must own disjoint key spaces, or each would
 * resolve the other's rows on every run.
 */
export const BILLING_ALERT_PREFIX = "billing:";

export function isBillingAlertKey(key: string): boolean {
  return key.startsWith(BILLING_ALERT_PREFIX);
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

/** Digest email for newly-opened alerts. null when there are none. */
export function alertEmail(
  newAlerts: HealthAlert[],
): { subject: string; html: string } | null {
  if (newAlerts.length === 0) return null;
  const subject = `⚠ Maratus: ${newAlerts.length} new health alert${newAlerts.length > 1 ? "s" : ""}`;
  const n = newAlerts.length;
  const body =
    emailEyebrow("Platform health") +
    emailHeading(`${n} new ${emailAccent(n > 1 ? "alerts." : "alert.")}`) +
    emailText("These health checks just tripped across the fleet:") +
    // Messages include tenant names (user-controlled) → escaped.
    emailDetails(
      newAlerts.map((a) => ({ label: a.severity.toUpperCase(), value: escapeHtml(a.message) })),
    ) +
    emailButton("https://console.maratus.co/admin", "Open the console");
  const html = emailLayout(body, {
    title: subject,
    preheader: newAlerts.map((a) => escapeHtml(a.message)).join(" · "),
  });
  return { subject, html };
}
