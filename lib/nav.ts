import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  Cpu,
  Store,
  Palette,
  BarChart3,
  LineChart,
  Wallet,
  Activity,
  FileText,
  KeyRound,
  HardDriveDownload,
  MonitorCog,
  Mail,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const ADMIN_NAV: NavItem[] = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard },
  { label: "Customers", href: "/admin/customers", icon: Users },
  { label: "Device Fleet", href: "/admin/devices", icon: Cpu },
  { label: "Health", href: "/admin/health", icon: Activity },
  { label: "Firmware", href: "/admin/firmware", icon: HardDriveDownload },
  { label: "Documents", href: "/admin/documents", icon: FileText },
  { label: "Billing & Revenue", href: "/admin/billing", icon: Wallet },
];

export const TENANT_NAV: NavItem[] = [
  { label: "Dashboard", href: "/tenant", icon: LayoutDashboard },
  { label: "Stores", href: "/tenant/stores", icon: Store },
  { label: "Branding", href: "/tenant/branding", icon: Palette },
  { label: "Device Settings", href: "/tenant/device-settings", icon: MonitorCog },
  { label: "Members", href: "/tenant/members", icon: Users },
  { label: "Reports", href: "/tenant/reports", icon: BarChart3 },
  { label: "Analytics", href: "/tenant/analytics", icon: LineChart },
  { label: "Documents", href: "/tenant/documents", icon: FileText },
  { label: "Billing", href: "/tenant/billing", icon: Wallet },
  { label: "API", href: "/tenant/api", icon: KeyRound },
  { label: "Contacts", href: "/tenant/contacts", icon: Mail },
  { label: "Activity", href: "/tenant/activity", icon: Activity },
];
