import { Leaf, QrCode } from "lucide-react";
import { MaratusWordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Shared two-column shell for the auth pages (login, signup, invite acceptance,
 * password reset). Left: wordmark + theme toggle, one glass card holding the
 * page's content, copyright footer. Right: the brand side with configurable
 * headline copy, closed by either a single line (`panelLine`) or three figures
 * (`panelStats`).
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
  panelLine,
}: {
  children: React.ReactNode;
  panelTitle: string;
  panelCopy: string;
  panelStats?: { k: string; v: string }[];
  panelLine?: string;
}) {
  return (
    // data-screen="auth" moves the ground light behind the card (app/globals.css).
    <div data-screen="auth" className="grid min-h-svh lg:grid-cols-2">
      {/* Form side */}
      <div className="flex min-w-0 flex-col px-4 py-7 md:px-12 md:py-8">
        <div className="flex items-center justify-between max-md:px-2">
          <MaratusWordmark />
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-start justify-center pt-10 md:items-center md:pt-0">
          <div className="glass-panel my-10 w-full max-w-md space-y-7 rounded-2xl px-5 py-6 md:p-8 max-md:mt-0">
            {children}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          © 2026 Maratus · Any content, one scan away.
        </p>
      </div>

      {/* Brand side */}
      <div className="auth-brand hidden lg:block">
        <div className="flex h-full flex-col justify-between p-12 pt-[38px]">
          <p className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <Leaf aria-hidden className="size-4 stroke-[1.6]" />
            Paperless by default
          </p>

          <div>
            <h2 className="max-w-[11em] font-display text-[52px] leading-[52px] font-semibold tracking-[-0.028em] text-balance">
              {panelTitle}
            </h2>
            <p className="mt-5 max-w-[30em] text-base leading-6 text-muted-foreground">
              {panelCopy}
            </p>
            {panelLine && (
              <p className="mt-10 border-t pt-5 font-display text-[26px] leading-8 font-medium tracking-[-0.018em]">
                {panelLine}
              </p>
            )}
            {panelStats && (
              <dl className="mt-10 grid grid-cols-3 border-t">
                {panelStats.map((s) => (
                  <div key={s.v} className="flex flex-col-reverse justify-end pt-5 pr-4">
                    <dt className="text-[13px] text-muted-foreground">{s.v}</dt>
                    <dd className="font-display text-[26px] leading-8 font-medium tracking-[-0.018em] tabular-nums">
                      {s.k}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <p className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <QrCode aria-hidden className="size-4 stroke-[1.6]" />
            Scan once. Saved forever.
          </p>
        </div>
      </div>
    </div>
  );
}
