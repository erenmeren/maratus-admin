import { PageHeader } from "@/components/page-header";
import { DeviceSettingsForm } from "@/components/device-settings-form";
import { getTenantDeviceSettings } from "@/lib/data";
import { requireSection } from "@/lib/session";

export default async function DeviceSettingsPage() {
  const { organizationId, canManage: canEdit } = await requireSection("deviceSettings");
  const settings = await getTenantDeviceSettings(organizationId);

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
