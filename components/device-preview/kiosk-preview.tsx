import { Leaf } from "lucide-react";
import { FauxQR } from "./qr-code";
import { readableOn, withAlpha } from "@/lib/color";
import { cn } from "@/lib/utils";

export type KioskScreen = "idle" | "qr";

export interface KioskBrand {
  brandColor: string;
  logoText: string;
  logoUrl?: string | null;
  storeName: string;
}

/**
 * 720×720 kiosk mockup. Sizing is container-query based (cqw units), so the
 * design reference is a 720px square but it scales to any container width while
 * staying perfectly square. Reused on the Branding live-preview screen.
 *
 * The store's brand color is applied ONLY here — it is tenant DATA, never app
 * chrome.
 */
export function KioskPreview({
  brand,
  screen,
  className,
}: {
  brand: KioskBrand;
  screen: KioskScreen;
  className?: string;
}) {
  const fg = readableOn(brand.brandColor);

  const Logo = ({ color, size }: { color: string; size: number }) =>
    brand.logoUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={brand.logoUrl}
        alt={brand.logoText}
        style={{ height: `${size}cqw`, maxWidth: "70%", objectFit: "contain" }}
      />
    ) : (
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: `${size}cqw`,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color,
          lineHeight: 1,
        }}
      >
        {brand.logoText}
      </span>
    );

  return (
    <div
      className={cn(
        "@container relative aspect-square w-full overflow-hidden rounded-[4cqw] shadow-2xl ring-1 ring-black/10 select-none",
        className,
      )}
      style={{ background: screen === "idle" ? brand.brandColor : "#f4f5f7" }}
    >
      {screen === "idle" ? (
        <IdleScreen brand={brand} fg={fg} Logo={Logo} />
      ) : (
        <QrScreen brand={brand} fg={fg} Logo={Logo} />
      )}
    </div>
  );
}

function IdleScreen({
  brand,
  fg,
  Logo,
}: {
  brand: KioskBrand;
  fg: string;
  Logo: (p: { color: string; size: number }) => React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-between">
      {/* ambient glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(120% 80% at 50% -10%, ${withAlpha("#ffffff", 0.18)}, transparent 60%)`,
        }}
      />
      <div
        className="flex items-center gap-[1.6cqw] pt-[9cqw] text-center"
        style={{ color: fg, opacity: 0.85 }}
      >
        <span
          style={{
            fontSize: "3cqw",
            letterSpacing: "0.35em",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          {brand.storeName}
        </span>
      </div>

      <div className="relative flex flex-col items-center gap-[5cqw] px-[8cqw] text-center">
        <Logo color={fg} size={13} />
        <p
          style={{
            color: fg,
            fontSize: "4.4cqw",
            fontWeight: 500,
            maxWidth: "80%",
            lineHeight: 1.35,
          }}
        >
          Thanks for visiting — your receipt is going paperless.
        </p>
        <div
          className="flex items-center gap-[2cqw] rounded-full"
          style={{
            background: withAlpha(fg === "#ffffff" ? "#ffffff" : "#000000", 0.14),
            color: fg,
            padding: "2.4cqw 5cqw",
            fontSize: "3.6cqw",
            fontWeight: 600,
          }}
        >
          <span
            className="inline-block animate-pulse rounded-full"
            style={{ width: "2.4cqw", height: "2.4cqw", background: fg }}
          />
          Tap anywhere to begin
        </div>
      </div>

      <div
        className="flex items-center gap-[1.4cqw] pb-[7cqw]"
        style={{ color: fg, opacity: 0.7, fontSize: "3cqw" }}
      >
        <Leaf style={{ width: "3.4cqw", height: "3.4cqw" }} />
        Powered by Ditto
      </div>
    </div>
  );
}

function QrScreen({
  brand,
  fg,
  Logo,
}: {
  brand: KioskBrand;
  fg: string;
  Logo: (p: { color: string; size: number }) => React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 flex flex-col">
      {/* header band in brand color */}
      <div
        className="flex items-center justify-between"
        style={{
          background: brand.brandColor,
          color: fg,
          padding: "5cqw 6cqw",
        }}
      >
        <Logo color={fg} size={6} />
        <span style={{ fontSize: "3cqw", fontWeight: 600, opacity: 0.85 }}>
          {brand.storeName}
        </span>
      </div>

      {/* body */}
      <div className="flex flex-1 flex-col items-center justify-center gap-[4cqw] px-[8cqw] text-center">
        <p
          style={{
            color: "#0b1220",
            fontFamily: "var(--font-display)",
            fontSize: "5.4cqw",
            fontWeight: 700,
          }}
        >
          Scan to download your receipt
        </p>

        <div
          className="rounded-[4cqw] bg-white p-[4cqw] shadow-lg ring-1 ring-black/5"
          style={{ "--qr-bg": "#ffffff" } as React.CSSProperties}
        >
          <FauxQR
            seed={11}
            style={{
              width: "42cqw",
              height: "42cqw",
              color: brand.brandColor,
              display: "block",
            }}
          />
        </div>

        <p style={{ color: "#5b6472", fontSize: "3.4cqw", lineHeight: 1.4 }}>
          Or text a copy to your phone. Valid for 90 days.
        </p>

        <div
          className="flex items-center gap-[1.5cqw] rounded-full"
          style={{
            background: withAlpha(brand.brandColor, 0.12),
            color: brand.brandColor,
            padding: "1.8cqw 4cqw",
            fontSize: "3cqw",
            fontWeight: 600,
          }}
        >
          <Leaf style={{ width: "3.2cqw", height: "3.2cqw" }} />
          You just saved a paper receipt
        </div>
      </div>

      {/* footer */}
      <div
        className="flex items-center justify-center gap-[1.4cqw] border-t"
        style={{
          borderColor: "rgba(0,0,0,0.06)",
          color: "#8a93a0",
          padding: "3.5cqw",
          fontSize: "2.8cqw",
        }}
      >
        Powered by Ditto · Digital receipts
      </div>
    </div>
  );
}
