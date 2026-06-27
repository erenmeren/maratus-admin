"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import {
  WorkspaceSwitcher,
  type Workspace,
} from "@/components/workspace-switcher";
import type { OrgRef } from "@/lib/session";
import { ADMIN_NAV, TENANT_NAV } from "@/lib/nav";

function isActive(pathname: string, href: string) {
  if (href === "/admin" || href === "/tenant") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppShell({
  workspace,
  groupLabel,
  topBarLabel,
  user,
  organizations,
  role,
  activeName,
  activeOrganizationId,
  children,
}: {
  workspace: Workspace;
  groupLabel: string;
  topBarLabel: string;
  user: { name: string; email: string; role: string };
  organizations: OrgRef[];
  role: string;
  activeName: string;
  activeOrganizationId: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Nav lives inside the client boundary so we never pass icon components
  // (functions) across the server→client edge.
  const nav = workspace === "admin" ? ADMIN_NAV : TENANT_NAV;
  // The active top-level section drives the header breadcrumb (wayfinding).
  const activeItem = nav.find((item) => isActive(pathname, item.href)) ?? null;
  // The user's role in the active realm, for the account-menu caption.
  const orgRole = organizations.find((o) => o.id === activeOrganizationId)?.role;
  const roleLabel =
    workspace === "admin"
      ? "Super Admin"
      : orgRole
        ? orgRole.charAt(0).toUpperCase() + orgRole.slice(1)
        : "Workspace";

  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <WorkspaceSwitcher
              active={workspace}
              role={role}
              organizations={organizations}
              activeName={activeName}
              activeOrganizationId={activeOrganizationId}
            />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>{groupLabel}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {nav.map((item) => {
                    const active = isActive(pathname, item.href);
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.label}
                        >
                          <Link href={item.href}>
                            <item.icon />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <div className="rounded-lg border bg-sidebar-accent/40 p-3 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              <p className="font-medium text-foreground">Paperless since 2024</p>
              <p className="mt-0.5">Every QR scan is a document that never printed.</p>
            </div>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

        <SidebarInset>
          <header className="edge-perforation relative sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 bg-gradient-to-b from-background/92 to-background/65 px-3 backdrop-blur-md sm:px-4">
            {/* Emerald hairline — the top edge of the "document slip". */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent"
            />

            <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />

            {/* Wayfinding: where you are, set in the brand display face. */}
            {activeItem ? (
              <div
                key={pathname}
                className="flex min-w-0 items-center gap-2.5 duration-300 animate-in fade-in-50 slide-in-from-left-1"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
                  <activeItem.icon className="size-4" />
                </span>
                <div className="flex min-w-0 items-baseline gap-1.5">
                  <span className="hidden text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/80 sm:inline">
                    {workspace === "admin" ? "Platform" : "Workspace"}
                  </span>
                  <span className="hidden text-muted-foreground/30 sm:inline">/</span>
                  <span className="truncate font-display text-sm font-semibold tracking-tight">
                    {activeItem.label}
                  </span>
                </div>
              </div>
            ) : (
              <span className="font-display text-sm font-semibold tracking-tight">
                {topBarLabel}
              </span>
            )}

            <div className="ml-auto flex items-center gap-1.5">
              <ThemeToggle />
              <UserMenu
                name={user.name}
                email={user.email}
                subtitle={roleLabel}
              />
            </div>
          </header>
          <main className="flex-1 p-4 sm:p-6 lg:p-8">
            <div className="mx-auto w-full max-w-7xl space-y-6">{children}</div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
