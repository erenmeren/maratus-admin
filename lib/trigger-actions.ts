export const TRIGGER_ACTIONS = ["show_qr"] as const;
export type TriggerAction = (typeof TRIGGER_ACTIONS)[number];

const COST: Record<TriggerAction, number> = { show_qr: 1 };
export function creditCostForAction(action: TriggerAction): number {
  return COST[action];
}

const MAX_URL = 2048;
export type TriggerBody = { action: TriggerAction; payload: Record<string, unknown> };
export type ValidateResult = { ok: true; action: TriggerAction; payload: Record<string, unknown> } | { ok: false; error: string };

function isValidUrl(u: unknown): u is string {
  if (typeof u !== "string" || u.length === 0 || u.length > MAX_URL) return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateTriggerBody(raw: unknown): ValidateResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Body must be a JSON object." };
  const b = raw as Record<string, unknown>;
  if (!(TRIGGER_ACTIONS as readonly string[]).includes(b.action as string)) {
    return { ok: false, error: `Unknown action. Supported: ${TRIGGER_ACTIONS.join(", ")}.` };
  }
  const action = b.action as TriggerAction;
  const payload = (b.payload ?? {}) as Record<string, unknown>;
  if (action === "show_qr" && !isValidUrl(payload.url)) {
    return { ok: false, error: "payload.url must be an http(s) URL ≤ 2048 chars." };
  }
  return { ok: true, action, payload };
}
