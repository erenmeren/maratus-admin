import { PageHeader } from "@/components/page-header";
import { BrandingEditor } from "@/components/branding-editor";
import { getTenant } from "@/lib/data";
import { requireTenant } from "@/lib/session";

export default async function BrandingPage() {
  const { organizationId } = await requireTenant();
  const tenant = await getTenant(organizationId);

  return (
    <>
      <PageHeader
        title="Branding"
        description="Customize how your kiosks look to customers. Changes preview live."
      />
      <BrandingEditor
        initialColor={tenant.brandColor}
        initialLogoText={tenant.logoText}
        initialStaffPin={tenant.staffPin}
        storeName={tenant.name}
      />
    </>
  );
}
