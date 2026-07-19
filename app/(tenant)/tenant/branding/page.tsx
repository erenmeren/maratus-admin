import { PageHeader } from "@/components/page-header";
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

  return (
    <>
      <PageHeader
        title="Branding"
        description="Customize how your printers look to customers. Changes preview live."
      />
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
    </>
  );
}
