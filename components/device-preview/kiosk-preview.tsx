import * as React from "react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { FauxQR } from "./qr-code";
import { KioskClock } from "./kiosk-clock";
import { resolveBrandTokens, withAlpha } from "@/lib/color";
import {
  DEFAULT_KIOSK_LAYOUT,
  type KioskLayout,
  type KioskObject,
} from "@/lib/kiosk-layout";
import { cn } from "@/lib/utils";

// Plus Jakarta Sans — the kiosk design's signature face (rounded, premium, calm).
// Scoped to the preview via a CSS variable; the app chrome keeps its own fonts.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

/**
 * The seven customer-facing kiosk states. `qr` is the receipt-ready hero (kept
 * under that name for back-compat with existing embeds). The five extra states
 * are surfaced by the Branding preview's screen switcher.
 */
export type KioskScreen =
  | "idle"
  | "processing"
  | "qr"
  | "sent"
  | "error"
  | "paused"
  | "setup";

export interface KioskBrand {
  /** Accent = the tenant's brand color. */
  brandColor: string;
  /** Optional theme tokens — derived from the accent when omitted. */
  brandBg?: string | null;
  brandFg?: string | null;
  brandMuted?: string | null;
  /** Logo glyph style when no uploaded logo is present. */
  mark?: "diamond" | "bean";
  logoText: string;
  logoUrl?: string | null;
  storeName: string;
  /** Lane/register label shown on the idle screen (e.g. "Lane 3"). */
  lane?: string;
  /** Pairing code shown on the setup screen. */
  pairingCode?: string;
  /** Static clock time on the idle screen (mockup; no live ticking). */
  time?: string;
}

/** 720px design reference → container-query width units (100cqw = the square). */
const cq = (px: number) => `${(px / 7.2).toFixed(2)}cqw`;

/** CSS vars + font for the kiosk canvas. Shared by the preview and the studio. */
export function kioskRootStyle(brand: KioskBrand): React.CSSProperties {
  const t = resolveBrandTokens(brand.brandColor, {
    bg: brand.brandBg,
    fg: brand.brandFg,
    muted: brand.brandMuted,
  });
  return {
    "--k-accent": t.accent,
    "--k-accent-fg": "#ffffff",
    "--k-bg": t.bg,
    "--k-fg": t.fg,
    "--k-muted": t.muted,
    "--k-card": "#ffffff",
    "--k-hairline": withAlpha(t.fg, 0.1),
    "--k-accent-soft": withAlpha(t.accent, 0.1),
    fontFamily: jakarta.style.fontFamily,
  } as React.CSSProperties;
}

/**
 * 720×720 kiosk mockup, container-query sized (cqw) so it scales to any width
 * while staying square. The tenant's brand tokens are applied ONLY here — they
 * are tenant DATA, never app chrome. Reused on the Branding live preview and a
 * few device dialogs (which pass just `brandColor`; bg/fg/muted derive).
 */
export function KioskPreview({
  brand,
  screen,
  layout = DEFAULT_KIOSK_LAYOUT,
  className,
}: {
  brand: KioskBrand;
  screen: KioskScreen;
  /** Modular idle-screen layout (only the idle screen uses it). */
  layout?: KioskLayout;
  className?: string;
}) {
  const vars = kioskRootStyle(brand);

  const screens: Record<KioskScreen, React.ReactNode> = {
    idle: <IdleScreen brand={brand} layout={layout} />,
    processing: <ProcessingScreen />,
    qr: <ReceiptScreen brand={brand} />,
    sent: <SentScreen />,
    error: <ErrorScreen />,
    paused: <PausedScreen brand={brand} />,
    setup: <SetupScreen brand={brand} />,
  };

  return (
    <div
      className={cn(
        "@container relative aspect-square w-full overflow-hidden rounded-[4cqw] shadow-2xl ring-1 ring-black/10 select-none",
        className,
      )}
      style={{
        ...vars,
        background: screen === "error" ? "#f7f1e8" : "var(--k-bg)",
        color: "var(--k-fg)",
      }}
    >
      {screens[screen]}
    </div>
  );
}

/* ── Logo: uploaded image, or a brand mark + wordmark ───────────────── */
function Logo({
  brand,
  size,
  stacked = false,
  mono = false,
}: {
  brand: KioskBrand;
  size: number; // mark size in design px
  stacked?: boolean;
  mono?: boolean;
}) {
  if (brand.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={brand.logoUrl}
        alt={brand.logoText}
        style={{ height: cq(size), maxWidth: "70%", objectFit: "contain" }}
      />
    );
  }
  const markColor = mono ? "var(--k-fg)" : "var(--k-accent)";
  const mark =
    brand.mark === "bean" ? (
      <svg viewBox="0 0 48 48" fill="none" style={{ width: cq(size), height: cq(size) }} aria-hidden>
        <circle cx="24" cy="24" r="22" fill={markColor} />
        <path d="M16 31c0-10 6-16 16-16-1 10-6 16-16 16Z" fill="#fff" opacity="0.92" />
        <path d="M17 30c5-1 11-7 13-13" stroke={markColor} strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    ) : (
      <svg viewBox="0 0 48 48" fill="none" style={{ width: cq(size), height: cq(size) }} aria-hidden>
        <rect x="6" y="6" width="36" height="36" rx="11" fill={markColor} />
        <path d="M24 15l9 9-9 9-9-9 9-9Z" fill="#fff" opacity="0.92" />
      </svg>
    );
  const word = (
    <span
      style={{
        fontSize: cq(size * (stacked ? 0.62 : 0.52)),
        fontWeight: 800,
        letterSpacing: "-0.02em",
        color: "var(--k-fg)",
        lineHeight: 1,
        textAlign: "center",
      }}
    >
      {brand.logoText}
    </span>
  );
  return (
    <div
      style={{
        display: "flex",
        flexDirection: stacked ? "column" : "row",
        alignItems: "center",
        gap: cq(stacked ? 18 : size * 0.34),
      }}
    >
      {mark}
      {word}
    </div>
  );
}

/* ── 1 · IDLE / READY (object boxes) ─────────────────────────────────── */
function IdleScreen({ brand, layout }: { brand: KioskBrand; layout: KioskLayout }) {
  const ordered = [...layout.objects].sort((a, b) => a.z - b.z);
  return (
    <div className="absolute inset-0">
      {ordered
        .filter((o) => o.visible)
        .map((o) => (
          <div
            key={o.id}
            style={{
              position: "absolute",
              left: `${o.x * 100}%`,
              top: `${o.y * 100}%`,
              width: `${o.w * 100}%`,
              height: `${o.h * 100}%`,
              zIndex: o.z,
            }}
          >
            <ObjectVisual object={o} brand={brand} layout={layout} />
          </div>
        ))}
    </div>
  );
}

/**
 * Renders one idle object filling its box. Text wraps inside the box at its own
 * font size; logo/clock/wifi size deterministically from the box (no transform
 * scale, no DOM measurement). Shared by the read-only preview and the editor.
 */
export function ObjectVisual({
  object,
  brand,
  layout,
}: {
  object: KioskObject;
  brand: KioskBrand;
  layout: KioskLayout;
}) {
  switch (object.type) {
    case "text":
      return <TextObject object={object} />;
    case "logo":
      return <LogoObject object={object} brand={brand} />;
    case "clock":
      return <ClockObject object={object} layout={layout} />;
    case "wifi":
      return <WifiObject object={object} level={layout.wifiLevel} />;
    default:
      return null;
  }
}

function TextObject({ object }: { object: KioskObject }) {
  const align = object.align ?? "center";
  const justify = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: justify,
        textAlign: align,
        fontSize: cq(object.fontSize ?? 22),
        fontWeight: 600,
        color: "var(--k-fg)",
        lineHeight: 1.15,
        overflow: "hidden",
        overflowWrap: "anywhere",
        whiteSpace: "pre-wrap",
      }}
    >
      {object.text}
    </div>
  );
}

function LogoObject({ object, brand }: { object: KioskObject; brand: KioskBrand }) {
  if (brand.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={brand.logoUrl} alt={brand.logoText} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    );
  }
  // Height-driven so the stacked mark + wordmark fits the box; overflow clipped
  // so an undersized box never lets the logo overlap neighbouring objects.
  const size = object.h * 720 * 0.55;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <Logo brand={brand} size={size} stacked />
    </div>
  );
}

function ClockObject({ object, layout }: { object: KioskObject; layout: KioskLayout }) {
  const timeFont = object.h * 720 * 0.5; // time font ~ half the box height
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <KioskClock timezone={layout.clockTimezone} hour24={layout.clock24h} size={timeFont} />
    </div>
  );
}

function WifiObject({ object, level }: { object: KioskObject; level: number }) {
  const base = Math.min(object.w, object.h) * 720; // fit size in design px
  const bars = [0.45, 0.65, 0.85, 1];
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: cq(base * 0.14), color: "var(--k-muted)" }}>
      {bars.map((bh, i) => (
        <span
          key={i}
          style={{
            width: cq(base * 0.22),
            height: cq(base * bh),
            borderRadius: cq(base * 0.1),
            background: "var(--k-fg)",
            opacity: i < level ? 0.85 : 0.2,
          }}
        />
      ))}
    </div>
  );
}

/* ── 2 · PROCESSING ─────────────────────────────────────────────────── */
function ProcessingScreen() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ gap: cq(46) }}>
      <div
        className="animate-spin rounded-full"
        style={{
          width: cq(108),
          height: cq(108),
          border: `${cq(8)} solid var(--k-accent-soft)`,
          borderTopColor: "var(--k-accent)",
        }}
      />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: cq(40), fontWeight: 700, letterSpacing: "-0.6px", whiteSpace: "nowrap" }}>
          Preparing your receipt…
        </div>
        <div style={{ fontSize: cq(23), fontWeight: 500, color: "var(--k-muted)", marginTop: cq(14) }}>
          This only takes a moment
        </div>
      </div>
    </div>
  );
}

/* ── 3 · RECEIPT READY — HERO ───────────────────────────────────────── */
function ReceiptScreen({ brand }: { brand: KioskBrand }) {
  const remain = "0:48";
  const progress = 0.34;
  return (
    <div className="absolute inset-0 flex flex-col items-center" style={{ padding: cq(44) }}>
      <div style={{ marginTop: cq(6) }}>
        <Logo brand={brand} size={40} />
      </div>
      <div
        style={{
          fontSize: cq(44),
          fontWeight: 800,
          letterSpacing: "-0.9px",
          marginTop: cq(26),
          textAlign: "center",
          lineHeight: 1.05,
        }}
      >
        Scan to get your receipt
      </div>
      <div
        style={{
          marginTop: cq(28),
          background: "#fff",
          borderRadius: cq(32),
          padding: cq(30),
          boxShadow: "0 24px 60px -18px rgba(15,20,40,0.30), 0 2px 8px rgba(15,20,40,0.06)",
        }}
      >
        <FauxQR seed={11} style={{ width: cq(300), height: cq(300), color: "#0b0b0c", display: "block" }} />
      </div>
      <div style={{ marginTop: cq(22), fontSize: cq(22), fontWeight: 500, color: "var(--k-muted)" }}>
        Point your phone camera at the code
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ width: "100%", maxWidth: cq(480) }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: cq(17),
            fontWeight: 600,
            color: "var(--k-muted)",
            marginBottom: cq(10),
          }}
        >
          <span>Code expires</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{remain}</span>
        </div>
        <div style={{ height: cq(8), borderRadius: cq(8), background: "var(--k-hairline)", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${Math.max(0, (1 - progress) * 100)}%`,
              background: "var(--k-accent)",
              borderRadius: cq(8),
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── 4 · SENT ✓ ─────────────────────────────────────────────────────── */
function SentScreen() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ gap: cq(44) }}>
      <div
        className="flex items-center justify-center rounded-full"
        style={{
          width: cq(168),
          height: cq(168),
          background: "var(--k-accent)",
          color: "var(--k-accent-fg)",
          boxShadow: "0 22px 50px -14px var(--k-accent-soft)",
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" style={{ width: cq(92), height: cq(92) }}>
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: cq(46), fontWeight: 800, letterSpacing: "-0.8px" }}>Your receipt is on its way</div>
        <div style={{ fontSize: cq(24), fontWeight: 500, color: "var(--k-muted)", marginTop: cq(16) }}>
          Check your phone — all set. Thank you!
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: cq(40),
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: cq(17),
          fontWeight: 500,
          color: "var(--k-muted)",
        }}
      >
        Returning to start…
      </div>
    </div>
  );
}

/* ── 5 · ERROR / OFFLINE ────────────────────────────────────────────── */
function ErrorScreen() {
  const warn = "#b9772a";
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ gap: cq(40), padding: cq(56) }}>
      <div
        className="flex items-center justify-center rounded-full"
        style={{ width: cq(138), height: cq(138), background: "rgba(185,119,42,0.12)", color: warn }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" style={{ width: cq(70), height: cq(70) }}>
          <path d="M2 8.5a16 16 0 0 1 6-4M22 8.5a16 16 0 0 0-3.5-2.8" />
          <path d="M8.5 15.5a6 6 0 0 1 5-1.3" />
          <path d="M3 3l18 18" />
        </svg>
      </div>
      <div style={{ textAlign: "center", maxWidth: cq(540) }}>
        <div style={{ fontSize: cq(42), fontWeight: 800, letterSpacing: "-0.7px", color: "#3a3024" }}>
          We couldn’t send your receipt
        </div>
        <div style={{ fontSize: cq(25), fontWeight: 500, color: "#7a6a52", marginTop: cq(18), lineHeight: 1.4 }}>
          The device is offline right now.
        </div>
      </div>
      <div
        style={{
          marginTop: cq(6),
          padding: `${cq(20)} ${cq(30)}`,
          borderRadius: cq(20),
          background: "rgba(185,119,42,0.10)",
          color: "#7a5a23",
          fontSize: cq(24),
          fontWeight: 700,
          textAlign: "center",
          maxWidth: cq(560),
        }}
      >
        Please ask a team member for a paper receipt
      </div>
    </div>
  );
}

/* ── 6 · DISABLED / PAUSED ──────────────────────────────────────────── */
function PausedScreen({ brand }: { brand: KioskBrand }) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center"
      style={{ gap: cq(40), padding: cq(56), opacity: 0.92 }}
    >
      <div style={{ opacity: 0.32, filter: "grayscale(0.6)" }}>
        <Logo brand={brand} size={84} stacked />
      </div>
      <div
        className="flex items-center"
        style={{
          gap: cq(12),
          padding: `${cq(12)} ${cq(22)}`,
          borderRadius: cq(100),
          background: "var(--k-hairline)",
          color: "var(--k-muted)",
          fontSize: cq(20),
          fontWeight: 600,
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ width: cq(22), height: cq(22) }}>
          <path d="M9 6v12M15 6v12" />
        </svg>
        Currently unavailable
      </div>
      <div style={{ fontSize: cq(22), fontWeight: 500, color: "var(--k-muted)", textAlign: "center", maxWidth: cq(460) }}>
        Digital receipts are paused at this register.
      </div>
    </div>
  );
}

/* ── 7 · SETUP / PAIRING ────────────────────────────────────────────── */
function SetupScreen({ brand }: { brand: KioskBrand }) {
  const code = brand.pairingCode ?? "K7P-4QX";
  const steps = [
    "Open your store admin dashboard",
    "Go to Devices → Add device",
    "Enter the pairing code below",
  ];
  return (
    <div className="absolute inset-0 flex flex-col" style={{ padding: cq(52) }}>
      <div className="flex items-center justify-between">
        <Logo brand={brand} size={36} mono />
        <div style={{ display: "flex", alignItems: "center", gap: cq(9), fontSize: cq(17), fontWeight: 600, color: "#2bb673" }}>
          <span
            style={{
              width: cq(11),
              height: cq(11),
              borderRadius: "50%",
              background: "#2bb673",
              boxShadow: "0 0 0 4px rgba(43,182,115,0.16)",
            }}
          />
          Connected
        </div>
      </div>
      <div style={{ marginTop: cq(30) }}>
        <div style={{ fontSize: cq(40), fontWeight: 800, letterSpacing: "-0.8px" }}>Let’s pair this device</div>
        <div style={{ fontSize: cq(22), fontWeight: 500, color: "var(--k-muted)", marginTop: cq(12) }}>
          Claim it from your admin dashboard to start.
        </div>
      </div>
      <div className="flex flex-col" style={{ gap: cq(16), marginTop: cq(30) }}>
        {steps.map((s, i) => (
          <div key={i} className="flex items-center" style={{ gap: cq(16) }}>
            <div
              className="flex items-center justify-center"
              style={{
                width: cq(38),
                height: cq(38),
                borderRadius: "50%",
                background: "var(--k-accent-soft)",
                color: "var(--k-accent)",
                fontSize: cq(20),
                fontWeight: 800,
                flex: "0 0 auto",
              }}
            >
              {i + 1}
            </div>
            <div style={{ fontSize: cq(22), fontWeight: 600 }}>{s}</div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <div
        className="flex items-center justify-between"
        style={{
          background: "var(--k-card)",
          border: "1px solid var(--k-hairline)",
          borderRadius: cq(26),
          padding: `${cq(26)} ${cq(30)}`,
          boxShadow: "0 12px 32px -18px rgba(15,20,40,0.30)",
        }}
      >
        <div>
          <div style={{ fontSize: cq(16), fontWeight: 700, color: "var(--k-muted)", letterSpacing: "1.4px", textTransform: "uppercase" }}>
            Pairing code
          </div>
          <div
            style={{
              fontSize: cq(60),
              fontWeight: 800,
              letterSpacing: "4px",
              color: "var(--k-accent)",
              fontVariantNumeric: "tabular-nums",
              marginTop: cq(4),
            }}
          >
            {code}
          </div>
        </div>
        <div style={{ background: "#fff", borderRadius: cq(14), padding: cq(10), border: "1px solid var(--k-hairline)" }}>
          <FauxQR seed={code.length + 3} style={{ width: cq(104), height: cq(104), color: "#0b0b0c", display: "block" }} />
        </div>
      </div>
    </div>
  );
}
