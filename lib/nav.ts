import type { LucideIcon } from "lucide-react";
import type { Section } from "@/lib/roles";
import {
  LayoutDashboard,
  Users,
  Cpu,
  Store,
  Palette,
  Wallet,
  Activity,
  KeyRound,
  HardDriveDownload,
  MonitorCog,
  Boxes,
  Pin,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  section?: Section;
}

export const ADMIN_NAV: NavItem[] = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard },
  { label: "Customers", href: "/admin/customers", icon: Users },
  { label: "Device Fleet", href: "/admin/devices", icon: Cpu },
  { label: "Inventory", href: "/admin/inventory", icon: Boxes },
  { label: "Health", href: "/admin/health", icon: Activity },
  { label: "Firmware", href: "/admin/firmware", icon: HardDriveDownload },
  { label: "Billing", href: "/admin/billing", icon: Wallet },
];

export const TENANT_NAV: NavItem[] = [
  { label: "Dashboard", href: "/tenant", icon: LayoutDashboard, section: "dashboard" },
  { label: "Stores", href: "/tenant/stores", icon: Store, section: "stores" },
  { label: "Devices", href: "/tenant/devices", icon: Cpu, section: "devices" },
  { label: "Device Settings", href: "/tenant/device-settings", icon: MonitorCog, section: "deviceSettings" },
  { label: "Pinned QR", href: "/tenant/pinned-qr", icon: Pin, section: "pinnedQr" },
  { label: "Branding", href: "/tenant/branding", icon: Palette, section: "branding" },
  { label: "Members", href: "/tenant/members", icon: Users, section: "members" },
  { label: "Billing", href: "/tenant/billing", icon: Wallet, section: "billing" },
  { label: "API", href: "/tenant/api", icon: KeyRound, section: "api" },
  { label: "Activity", href: "/tenant/activity", icon: Activity, section: "activity" },
];
