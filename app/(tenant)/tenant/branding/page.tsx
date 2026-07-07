import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { BrandingEditor } from "@/components/branding-editor";
import { BrandingStudioVariant } from "@/components/branding-studio/variant-studio";
import { BrandingGalleryVariant } from "@/components/branding-studio/variant-gallery";
import { BrandingRefinedVariant } from "@/components/branding-studio/variant-refined";
import { getTenant, getTenantBranding } from "@/lib/data";
import { requireTenant } from "@/lib/session";
import { cn } from "@/lib/utils";

// Prototype gate: three candidate Branding studio layouts live side by side
// behind ?layout= until one is chosen; the switcher below flips between them.
const LAYOUTS = [
  { key: "current", label: "Current" },
  { key: "studio", label: "A · Canvas Studio" },
  { key: "gallery", label: "B · Gallery" },
  { key: "refined", label: "C · Refined" },
] as const;
type LayoutKey = (typeof LAYOUTS)[number]["key"];

export default async function BrandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx, organizationId } = await requireTenant();
  const [tenant, branding, raw] = await Promise.all([
    getTenant(organizationId),
    getTenantBranding(organizationId),
    searchParams,
  ]);

  const layout: LayoutKey = LAYOUTS.some((l) => l.key === raw.layout)
    ? (raw.layout as LayoutKey)
    : "current";

  const membership = ctx.organizations.find((o) => o.id === organizationId);
  const canEdit = !!membership && ["owner", "admin"].includes(membership.role);

  const variantProps = {
    initialColor: branding.brandColor,
    initialConfig: branding.printerConfig,
    initialBg: branding.brandBg,
    initialFg: branding.brandFg,
    initialMuted: branding.brandMuted,
    initialLogoText: tenant.logoText,
    initialStaffPin: branding.staffPin,
    storeName: tenant.name,
    canEdit,
  };

  return (
    <>
      <PageHeader
        title="Branding"
        description="Customize how your printers look to customers. Changes preview live."
      />

      {/* Prototype switcher — remove when a layout is chosen */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-dashed bg-muted/30 p-1.5 text-sm">
        <span className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Prototype
        </span>
        {LAYOUTS.map((l) => (
          <Link
            key={l.key}
            href={l.key === "current" ? "/tenant/branding" : `/tenant/branding?layout=${l.key}`}
            className={cn(
              "rounded-lg px-3 py-1.5 transition-colors",
              layout === l.key
                ? "bg-background font-medium shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {l.label}
          </Link>
        ))}
      </div>

      {layout === "studio" && <BrandingStudioVariant {...variantProps} />}
      {layout === "gallery" && <BrandingGalleryVariant {...variantProps} />}
      {layout === "refined" && <BrandingRefinedVariant {...variantProps} />}
      {layout === "current" && <BrandingEditor {...variantProps} />}
    </>
  );
}
