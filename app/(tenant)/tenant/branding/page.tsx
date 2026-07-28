import { BrandingStudio } from "@/components/branding-studio/branding-studio";
import { getTenant, getTenantBranding } from "@/lib/data";
import { requireTenant } from "@/lib/session";
import { canManageTenant } from "@/lib/roles";

export default async function BrandingPage() {
  const { ctx, organizationId } = await requireTenant();
  const [tenant, branding] = await Promise.all([
    getTenant(organizationId),
    getTenantBranding(organizationId),
  ]);

  const membership = ctx.organizations.find((o) => o.id === organizationId);
  const canEdit = canManageTenant(membership?.role);

  // No PageHeader and no page padding here on purpose: /tenant/branding is a
  // full-bleed route (see FULL_BLEED_ROUTES in components/app-shell.tsx). The
  // studio's dark stage carries its own header and save chrome.
  return (
    <BrandingStudio
      initialColor={branding.brandColor}
      initialConfig={branding.printerConfig}
      initialBg={branding.brandBg}
      initialFg={branding.brandFg}
      initialMuted={branding.brandMuted}
      initialLogoText={tenant.logoText}
      storeName={tenant.name}
      canEdit={canEdit}
    />
  );
}
