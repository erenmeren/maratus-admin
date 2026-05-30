import { PageHeader } from "@/components/page-header";
import { BrandingEditor } from "@/components/branding-editor";
import { getDefaultTenant } from "@/lib/data";

export default function BrandingPage() {
  const tenant = getDefaultTenant();

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
