import { PageHeader } from "@/components/page-header";
import { DeviceSettingsForm } from "@/components/device-settings-form";
import { getTenantDeviceSettings } from "@/lib/data";
import { requireTenant } from "@/lib/session";

export default async function DeviceSettingsPage() {
  const { ctx, organizationId } = await requireTenant();
  const settings = await getTenantDeviceSettings(organizationId);

  const membership = ctx.organizations.find((o) => o.id === organizationId);
  const canEdit = !!membership && ["owner", "admin"].includes(membership.role);

  return (
    <>
      <PageHeader
        title="Device Settings"
        description="Policies applied to every device in your organization. Devices update automatically."
      />
      <DeviceSettingsForm initial={settings} canEdit={canEdit} />
    </>
  );
}
