import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  Cpu,
  Store,
  Palette,
  BarChart3,
  Wallet,
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
  { label: "Billing & Revenue", href: "/admin/billing", icon: Wallet },
];

export const TENANT_NAV: NavItem[] = [
  { label: "Dashboard", href: "/tenant", icon: LayoutDashboard },
  { label: "Stores", href: "/tenant/stores", icon: Store },
  { label: "Branding", href: "/tenant/branding", icon: Palette },
  { label: "Reports", href: "/tenant/reports", icon: BarChart3 },
  { label: "Billing", href: "/tenant/billing", icon: Wallet },
];
