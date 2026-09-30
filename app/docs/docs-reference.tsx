"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import { Check, Copy, KeyRound, LogIn, Loader2, ListTree } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ThemeToggle } from "@/components/theme-toggle";
import { issuePlaygroundKey } from "@/lib/actions/playground";
import { freshIdempotencyKey } from "@/lib/docs-try-it";
import type { getPlaygroundContext } from "@/lib/actions/playground";

type Ctx = Awaited<ReturnType<typeof getPlaygroundContext>>;
type Playground = { key: string; expiresAt: string; scopes: string[] };

const HEADER_H = 64;

// Brand tokens mapped onto Scalar's theme variables (theme: "none").
const SCALAR_CSS = `
.light-mode {
  --scalar-color-1: #191820; --scalar-color-2: #56546a; --scalar-color-3: #8a8796;
  --scalar-color-accent: #191820;
  --scalar-background-1: #ffffff; --scalar-background-2: #f6f5f9; --scalar-background-3: #eeedf3;
  --scalar-background-accent: #d5fa5833;
  --scalar-border-color: #e3e1ea;
}
.dark-mode {
  --scalar-color-1: #f9f8fc; --scalar-color-2: #b9b7c6; --scalar-color-3: #8a8796;
  --scalar-color-accent: #d5fa58;
  --scalar-background-1: #121117; --scalar-background-2: #1a1921; --scalar-background-3: #24232d;
  --scalar-background-accent: #d5fa581f;
  --scalar-border-color: #2c2b36;
}
.light-mode, .dark-mode {
  --scalar-font: var(--font-sans), system-ui, sans-serif;
  --scalar-font-code: var(--font-mono), ui-monospace, monospace;
  --scalar-radius: 8px; --scalar-radius-lg: 12px;
}
.light-mode .t-doc__sidebar, .dark-mode .t-doc__sidebar { --scalar-sidebar-color-active: var(--scalar-color-accent); }
.scalar-app table code { white-space: nowrap; }
`;

export function DocsReference({
  ctx,
  loginHref,
  spec,
}: {
  ctx: Ctx;
  loginHref: string;
  /** Personalized spec for a signed-in visitor; null → fetch the public one. */
  spec: unknown;
}) {
  const { resolvedTheme } = useTheme();
  const [pg, setPg] = React.useState<Playground | null>(null);
  const [busy, setBusy] = React.useState(false);
  const now = useNow(pg ? 15_000 : null);
  const live = pg && new Date(pg.expiresAt).getTime() > now ? pg : null;

  async function enable() {
    setBusy(true);
    const res = await issuePlaygroundKey();
    setBusy(false);
    if (!res.ok) {
      toast.error("Couldn't enable Try it", { description: reasonText(res.reason) });
      return;
    }
    setPg({ key: res.key, expiresAt: res.expiresAt, scopes: res.scopes });
    toast.success("Try it is on", {
      description: "Requests run against your real devices with a 1-hour key.",
    });
  }

  const configuration = React.useMemo(
    () => ({
      ...(spec ? { content: spec as Record<string, unknown> } : { url: "/api/v1/openapi.json" }),
      theme: "none" as const,
      customCss: SCALAR_CSS,
      withDefaultFonts: false,
      hideDarkModeToggle: true,
      forceDarkModeState: resolvedTheme === "dark" ? ("dark" as const) : ("light" as const),
      hideClientButton: true,
      showDeveloperTools: "never" as const,
      documentDownloadType: "json" as const,
      telemetry: false,
      // Both send the spec to Scalar's hosted services — keep everything local.
      agent: { disabled: true },
      mcp: { disabled: true },
      persistAuth: false,
      // No sign-in (or an expired playground key) → read-only reference.
      hideTestRequestButton: !live,
      // Fresh Idempotency-Key per Send, or every trigger replays the first one.
      onRequestBuilt: ({ request }: { request: Request }) =>
        freshIdempotencyKey(request.headers, () => crypto.randomUUID()),
      authentication: live
        ? { preferredSecurityScheme: "bearerAuth", securitySchemes: { bearerAuth: { token: live.key } } }
        : undefined,
    }),
    [resolvedTheme, live, spec],
  );

  return (
    <div style={{ ["--scalar-custom-header-height" as string]: `${HEADER_H}px` }}>
      <header
        className="sticky top-0 z-50 flex items-center gap-3 border-b bg-background/90 px-4 backdrop-blur sm:px-6"
        style={{ height: HEADER_H }}
      >
        <a href="https://maratus.co" className="flex shrink-0 items-center gap-2.5" aria-label="Maratus">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/maratus-logo-ink.svg" alt="maratus." className="h-5 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/maratus-logo-light.svg" alt="maratus." className="hidden h-5 w-auto dark:block" />
          <span className="hidden font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground sm:inline">
            API Reference
          </span>
        </a>

        <div className="ml-auto flex items-center gap-2">
          {!ctx.signedIn ? (
            <Button asChild size="sm" className="bg-[#191820] text-[#d5fa58] hover:bg-[#191820]/90 dark:bg-[#d5fa58] dark:text-[#191820] dark:hover:bg-[#d5fa58]/90">
              <a href={loginHref}>
                <LogIn className="size-4" /> Sign in to try requests
              </a>
            </Button>
          ) : (
            <>
              <IdsPopover ctx={ctx} />
              {live ? (
                <span className="hidden items-center gap-2 rounded-full border px-3 py-1 text-xs sm:flex">
                  <span className="size-2 rounded-full bg-[#9bd11e]" />
                  Try it on · {ctx.organizationName} · {minutesLeft(live.expiresAt, now)} min
                </span>
              ) : (
                <Button
                  size="sm"
                  onClick={enable}
                  disabled={busy}
                  className="bg-[#191820] text-[#d5fa58] hover:bg-[#191820]/90 dark:bg-[#d5fa58] dark:text-[#191820] dark:hover:bg-[#d5fa58]/90"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                  Enable Try it
                </Button>
              )}
            </>
          )}
          <Button asChild size="sm" variant="ghost" className="hidden md:inline-flex">
            <a href="https://console.maratus.co" target="_blank" rel="noreferrer">
              Console
            </a>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {/* Remount on key change so Scalar picks up the new auth state. */}
      <ApiReferenceReact key={live?.key ?? "anon"} configuration={configuration} />
    </div>
  );
}

function IdsPopover({ ctx }: { ctx: Ctx }) {
  if (!ctx.signedIn) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <ListTree className="size-4" /> <span className="hidden sm:inline">Your IDs</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">{ctx.organizationName}</p>
          <p className="text-xs text-muted-foreground">Copy an ID into a request&apos;s path.</p>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          <IdGroup title="Devices" items={ctx.devices.map((d) => ({ id: d.id, label: d.name, sub: d.storeName }))} />
          <IdGroup title="Stores" items={ctx.stores.map((s) => ({ id: s.id, label: s.name }))} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function IdGroup({ title, items }: { title: string; items: { id: string; label: string; sub?: string | null }[] }) {
  return (
    <div className="py-1">
      <p className="px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">None yet.</p>
      ) : (
        items.map((it) => <IdRow key={it.id} {...it} />)
      )}
    </div>
  );
}

function IdRow({ id, label, sub }: { id: string; label: string; sub?: string | null }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(id);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">
          {label}
          {sub ? <span className="text-muted-foreground"> · {sub}</span> : null}
        </span>
        <span className="block truncate font-mono text-xs text-muted-foreground">{id}</span>
      </span>
      {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4 text-muted-foreground" />}
    </button>
  );
}

function useNow(intervalMs: number | null): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!intervalMs) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// Clamped to the 60-minute TTL: a client clock a few seconds behind the
// server would otherwise read "61 min" right after minting.
function minutesLeft(expiresAt: string, now: number): number {
  return Math.min(60, Math.max(1, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000)));
}

function reasonText(reason: string): string {
  switch (reason) {
    case "signed_out":
      return "Your session ended — sign in again.";
    case "no_org":
      return "Your account isn't a member of any organization.";
    case "archived":
      return "This organization is archived.";
    default:
      return "Please try again.";
  }
}
