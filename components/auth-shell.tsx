import { Leaf, QrCode } from "lucide-react";
import { MaratusWordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Shared two-column shell for the auth pages (login, signup, invite acceptance).
 * Left: wordmark + theme toggle header, centered `max-w-sm` content, copyright
 * footer. Right: the `bg-primary` brand panel with configurable headline copy.
 *
 * No "use client" directive on purpose — it renders server-side when used from a
 * server page and joins the client bundle when imported by a client form. Icons
 * are imported here (never passed as props) so nothing crosses the RSC boundary.
 */
export function AuthShell({
  children,
  panelTitle,
  panelCopy,
  panelStats,
}: {
  children: React.ReactNode;
  panelTitle: string;
  panelCopy: string;
  panelStats: { k: string; v: string }[];
}) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* Form side */}
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <MaratusWordmark />
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm space-y-8 py-10">{children}</div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          © 2026 Maratus · Any content, one scan away.
        </p>
      </div>

      {/* Brand side */}
      <div className="relative hidden overflow-hidden bg-primary lg:block">
        <div className="absolute inset-0 bg-grid text-primary-foreground/10" />
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-primary-foreground/10 blur-2xl" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-primary-foreground/10 blur-2xl" />

        <div className="relative flex h-full flex-col justify-between p-12 text-primary-foreground">
          <div className="inline-flex items-center gap-2 self-start rounded-full bg-primary-foreground/15 px-3 py-1 text-xs font-medium backdrop-blur">
            <Leaf className="size-3.5" />
            Paperless by default
          </div>

          <div className="space-y-6">
            <h2 className="font-display text-4xl font-bold leading-tight tracking-tight">
              {panelTitle}
            </h2>
            <p className="max-w-md text-primary-foreground/80">{panelCopy}</p>
            <div className="grid grid-cols-3 gap-4 pt-2">
              {panelStats.map((s) => (
                <div key={s.v}>
                  <p className="font-display text-2xl font-bold">{s.k}</p>
                  <p className="text-xs text-primary-foreground/70">{s.v}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm text-primary-foreground/70">
            <QrCode className="size-5" />
            Scan once. Saved forever.
          </div>
        </div>
      </div>
    </div>
  );
}
