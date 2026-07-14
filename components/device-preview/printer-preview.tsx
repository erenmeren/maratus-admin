"use client";

import * as React from "react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { FauxQR } from "./qr-code";
import { PrinterClock } from "./printer-clock";
import { resolveBrandTokens, withAlpha } from "@/lib/color";
import {
  screenColors,
  type PrinterConfig,
  type PrinterObject,
  type PrinterScreen,
} from "@/lib/printer-layout";
import { resolveIconComponent } from "@/lib/printer-icons";
import { cn } from "@/lib/utils";

// Re-export PrinterScreen so existing callers of `import { PrinterScreen } from ".../printer-preview"` keep working.
export type { PrinterScreen } from "@/lib/printer-layout";

// Plus Jakarta Sans — the printer design's signature face (rounded, premium, calm).
// Scoped to the preview via a CSS variable; the app chrome keeps its own fonts.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export interface PrinterBrand {
  /** Accent = the tenant's brand color. */
  brandColor: string;
  /** Optional theme tokens — derived from the accent when omitted. */
  brandBg?: string | null;
  brandFg?: string | null;
  brandMuted?: string | null;
  /** Logo glyph style when no uploaded logo is present. */
  mark?: "diamond" | "bean";
  logoText: string;
  storeName: string;
  /** Lane/register label shown on the idle screen (e.g. "Lane 3"). */
  lane?: string;
  /** Pairing code shown on the setup screen. */
  pairingCode?: string;
  /** Static clock time on the idle screen (mockup; no live ticking). */
  time?: string;
}

/** 720px design reference → container-query width units (100cqw = the square). */
export const cq = (px: number) => `${(px / 7.2).toFixed(2)}cqw`;

/** CSS vars + font for the printer canvas. Shared by the preview and the studio. */
export function printerRootStyle(brand: PrinterBrand): React.CSSProperties {
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

/** The brand with the screen's palette override applied (if any). */
export function effectiveBrand(
  brand: PrinterBrand,
  config: PrinterConfig,
  screen: PrinterScreen,
): PrinterBrand {
  const oc = screenColors(config, screen);
  if (!oc) return brand;
  return { ...brand, brandColor: oc.accent, brandBg: oc.bg, brandFg: oc.fg, brandMuted: oc.muted };
}

/**
 * 720×720 printer mockup, container-query sized (cqw) so it scales to any width
 * while staying square. Renders the visible objects of the given screen sorted by
 * z-index, each absolutely positioned inside the square canvas. Reused on the
 * Branding live preview and device dialogs.
 */
export function PrinterPreview({
  brand,
  config,
  screen,
  className,
}: {
  brand: PrinterBrand;
  config: PrinterConfig;
  screen: PrinterScreen;
  className?: string;
}) {
  const eb = effectiveBrand(brand, config, screen);
  const objects = [...config.screens[screen].objects]
    .filter((o) => o.visible)
    .sort((a, b) => a.z - b.z);
  return (
    <div
      className={cn(
        "@container relative aspect-square w-full overflow-hidden shadow-2xl ring-1 ring-black/10 select-none",
        className,
      )}
      style={{
        ...printerRootStyle(eb),
        background: "var(--k-bg)",
        color: "var(--k-fg)",
      }}
    >
      {objects.map((o) => (
        <div
          key={o.id}
          className="absolute"
          style={{
            left: `${o.x * 100}%`,
            top: `${o.y * 100}%`,
            width: `${o.w * 100}%`,
            height: `${o.h * 100}%`,
            zIndex: o.z,
          }}
        >
          <ObjectVisual object={o} brand={eb} config={config} />
        </div>
      ))}
    </div>
  );
}


/**
 * Renders one printer object filling its absolutely-positioned box. Text wraps
 * inside the box at its own font size; logo/clock/wifi/icon size deterministically
 * from the box (no transform scale, no DOM measurement). Shared by the read-only
 * preview and the editor stage.
 */
export function ObjectVisual({
  object,
  brand,
  config,
}: {
  object: PrinterObject;
  brand: PrinterBrand;
  config: PrinterConfig;
}) {
  switch (object.type) {
    case "text":
      return <TextObject object={object} />;
    case "logo":
      return <LogoObject object={object} brand={brand} />;
    case "clock":
      return <ClockObject object={object} timezone={config.clockTimezone} clock24h={config.clock24h} />;
    case "wifi":
      return <WifiObject object={object} level={config.wifiLevel} />;
    case "icon":
      return <IconObject object={object} brand={brand} />;
    case "image":
      return <ImageObject object={object} />;
    case "qr":
      return <QrObject object={object} />;
    case "spinner":
      return <SpinnerObject object={object} />;
    case "countdown":
      return <CountdownObject object={object} brand={brand} seconds={config.qrTimeoutSeconds} />;
    case "pairingCode":
      return <PairingCodeObject object={object} brand={brand} />;
    case "steps":
      return <StepsObject object={object} />;
    default:
      return null;
  }
}

/* ── Per-object renderers ────────────────────────────────────────────── */

function TextObject({ object }: { object: PrinterObject }) {
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

function LogoObject({ object, brand }: { object: PrinterObject; brand: PrinterBrand }) {
  const size = object.h * 720 * 0.42;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <span style={{ fontSize: cq(size), fontWeight: 700, color: "var(--k-fg)", textAlign: "center", lineHeight: 1.1, overflowWrap: "anywhere" }}>
        {brand.logoText}
      </span>
    </div>
  );
}

function ClockObject({
  object,
  timezone,
  clock24h,
}: {
  object: PrinterObject;
  timezone: string;
  clock24h: boolean;
}) {
  const timeFont = object.h * 720 * 0.5; // time font ~ half the box height
  const align = object.align ?? "center";
  const justify = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: justify, overflow: "hidden" }}>
      <PrinterClock
        timezone={timezone}
        hour24={clock24h}
        size={timeFont}
        showDate={object.clock?.showDate ?? true}
        showWeekday={object.clock?.showWeekday ?? true}
        align={align}
      />
    </div>
  );
}

function WifiObject({ object, level }: { object: PrinterObject; level: number }) {
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

/* ── New widget renderers (lifted from the former per-screen JSX) ────── */

/**
 * IconObject — lifted from SentScreen's hard-coded check SVG and generalised.
 * Renders a curated lucide preset or an uploaded R2 image (presigned by the
 * data layer) with optional tint and circular background.
 */
function IconObject({ object, brand: _brand }: { object: PrinterObject; brand: PrinterBrand }) {
  const ic = object.icon ?? { source: "preset" as const };
  const tintVar =
    ic.tint === "muted" ? "var(--k-muted)" :
    ic.tint === "none" ? "var(--k-fg)" :
    "var(--k-accent)"; // "warn" (legacy stored configs) renders as accent — error screen uses brand colors
  const Inner = () =>
    ic.source === "upload" && ic.url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={ic.signedUrl ?? ic.url} alt="" className="size-full object-contain" />
    ) : (
      (() => {
        const Glyph = resolveIconComponent(ic.preset);
        return <Glyph className="size-full" style={{ color: ic.circle ? "var(--k-bg)" : tintVar }} strokeWidth={2.5} />;
      })()
    );
  if (ic.circle) {
    return (
      <div className="flex size-full items-center justify-center rounded-full p-[18%]" style={{ background: tintVar, boxShadow: "0 22px 50px -14px var(--k-accent-soft)" }}>
        <Inner />
      </div>
    );
  }
  return (
    <div className="flex size-full items-center justify-center" style={{ color: tintVar }}>
      <Inner />
    </div>
  );
}

function ImageObject({ object }: { object: PrinterObject }) {
  const src = object.image?.signedUrl ?? object.image?.url ?? null;
  if (!src) {
    return <div style={{ width: "100%", height: "100%", border: "1px dashed var(--k-muted)", borderRadius: 8 }} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
  );
}

/**
 * QrObject — lifted from DocumentScreen's QR card and the SetupScreen's compact
 * QR. Renders a faux QR inside a white card at size-full.
 */
function QrObject({ object }: { object: PrinterObject }) {
  const compact = object.w < 0.25;
  return (
    <div
      className="flex size-full items-center justify-center"
      style={
        compact
          ? {
              background: "#fff",
              borderRadius: cq(14),
              padding: cq(10),
              border: "1px solid var(--k-hairline)",
            }
          : {
              background: "#fff",
              borderRadius: cq(32),
              padding: cq(20),
              boxShadow: "0 24px 60px -18px rgba(15,20,40,0.30), 0 2px 8px rgba(15,20,40,0.06)",
            }
      }
    >
      <FauxQR seed={11} style={{ width: "100%", height: "100%", color: "#0b0b0c", display: "block" }} />
    </div>
  );
}

/**
 * SpinnerObject — lifted from ProcessingScreen. A spinning ring that fills its
 * object box; the border thickness is fixed in cqw so it scales with the canvas.
 */
function SpinnerObject({ object: _object }: { object: PrinterObject }) {
  return (
    <div
      className="animate-spin rounded-full size-full"
      style={{
        border: `${cq(8)} solid var(--k-accent-soft)`,
        borderTopColor: "var(--k-accent)",
      }}
    />
  );
}

/**
 * CountdownObject — lifted from DocumentScreen's "Code expires" progress bar.
 * Preview values (remain/progress) are fixed for the mockup; the live printer
 * app substitutes real values via its own render path.
 */
function CountdownObject({ object: _object, brand: _brand, seconds }: { object: PrinterObject; brand: PrinterBrand; seconds: number }) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const remain = `${m}:${String(s).padStart(2, "0")}`;
  const progress = 0; // editor preview is static — show the full duration
  return (
    <div className="flex size-full flex-col justify-center">
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
  );
}

/**
 * PairingCodeObject — lifted from SetupScreen's pairing-code label + large
 * monospaced code. Reads `brand.pairingCode` for the preview value.
 */
function PairingCodeObject({ object: _object, brand }: { object: PrinterObject; brand: PrinterBrand }) {
  const code = brand.pairingCode ?? "K7P-4QX";
  return (
    <div className="flex size-full flex-col justify-center">
      <div
        style={{
          fontSize: cq(16),
          fontWeight: 700,
          color: "var(--k-muted)",
          letterSpacing: "1.4px",
          textTransform: "uppercase",
        }}
      >
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
  );
}

/**
 * StepsObject — lifted from SetupScreen's numbered steps list. The step copy is
 * fixed for the mockup (the live printer renders the same static instructions).
 */
function StepsObject({ object: _object }: { object: PrinterObject }) {
  const steps = [
    "Open your store admin dashboard",
    "Go to Devices → Add device",
    "Enter the pairing code below",
  ];
  return (
    <div className="flex size-full flex-col justify-center" style={{ gap: cq(16) }}>
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
  );
}
