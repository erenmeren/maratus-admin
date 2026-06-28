import { PageHeader } from "@/components/page-header";
import { BrandingEditor } from "@/components/branding-editor";
import { SupportContactForm } from "@/components/support-contact-form";
import { getTenant, getTenantBranding } from "@/lib/data";
import { requireTenant } from "@/lib/session";

export default async function BrandingPage() {
  const { ctx, organizationId } = await requireTenant();
  const [tenant, branding] = await Promise.all([
    getTenant(organizationId),
    getTenantBranding(organizationId),
  ]);

  const membership = ctx.organizations.find((o) => o.id === organizationId);
  const canEdit = !!membership && ["owner", "admin"].includes(membership.role);

  return (
    <>
      <PageHeader
        title="Branding"
        description="Customize how your printers look to customers. Changes preview live."
      />
      <BrandingEditor
        initialColor={branding.brandColor}
        initialConfig={branding.printerConfig}
        initialBg={branding.brandBg}
        initialFg={branding.brandFg}
        initialMuted={branding.brandMuted}
        initialLogoText={tenant.logoText}
        initialStaffPin={branding.staffPin}
        storeName={tenant.name}
        canEdit={canEdit}
      />
      <div className="mt-6">
        <SupportContactForm
          initialEmail={branding.supportEmail}
          initialUrl={branding.supportUrl}
          canEdit={canEdit}
        />
      </div>
    </>
  );
}
