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
import { canView } from "@/lib/roles";
import { cn } from "@/lib/utils";

// Pages that opt out of the shell's padded, max-w-7xl container and run
// edge-to-edge instead. Branding is an immersive canvas editor whose dark stage
// carries its own header and save chrome, so the page container's gutters and
// 1280px cap only shrink the workspace. Every other page keeps the standard
// rhythm — see the layout notes in CLAUDE.md before adding to this set.
const FULL_BLEED_ROUTES = new Set(["/tenant/branding"]);

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
  const fullBleed = FULL_BLEED_ROUTES.has(pathname);
  // Nav lives inside the client boundary so we never pass icon components
  // (functions) across the server→client edge.
  const orgRole = organizations.find((o) => o.id === activeOrganizationId)?.role;
  const nav =
    workspace === "admin"
      ? ADMIN_NAV
      : TENANT_NAV.filter((item) => !item.section || canView(orgRole, item.section));
  // The active top-level section drives the header breadcrumb (wayfinding).
  const activeItem = nav.find((item) => isActive(pathname, item.href)) ?? null;
  // The user's role in the active realm, for the account-menu caption.
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
          <SidebarHeader className="h-14 justify-center border-b">
            <WorkspaceSwitcher
              active={workspace}
              role={role}
              organizations={organizations}
              activeName={activeName}
              activeOrganizationId={activeOrganizationId}
            />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup className="py-3">
              <SidebarGroupLabel className="h-7 font-normal text-muted-foreground">
                {groupLabel}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {nav.map((item) => {
                    const active = isActive(pathname, item.href);
                    return (
                      <SidebarMenuItem key={item.href}>
                        {/* The one orange mark in the nav: a 2px bar on the sidebar's edge. */}
                        {active && (
                          <span
                            aria-hidden
                            className="pointer-events-none absolute top-2 -left-2 h-4 w-0.5 bg-primary max-md:top-2.5"
                          />
                        )}
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.label}
                          className="gap-2.5 text-muted-foreground max-md:h-9 transition-[width,height,padding,color,background-color] duration-[120ms] hover:bg-hover hover:text-foreground active:bg-hover data-active:bg-selected data-active:text-foreground [&_svg]:stroke-[1.6]"
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
          <SidebarFooter className="border-t p-4 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            <p>Any content, one scan away.</p>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

        <SidebarInset className="min-w-0 bg-transparent">
          {/* Glass: page content scrolls under the bar. */}
          <header className="glass-bar sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 pr-4 pl-2 sm:pr-6 sm:pl-4">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground [&_svg]:stroke-[1.6]" />

            {/* Wayfinding: where you are. */}
            {activeItem ? (
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <activeItem.icon
                  aria-hidden
                  className="mr-0.5 size-4 shrink-0 stroke-[1.6] text-muted-foreground"
                />
                <span className="hidden text-muted-foreground sm:inline">
                  {workspace === "admin" ? "Platform" : "Workspace"}
                </span>
                <span aria-hidden className="hidden text-disabled-foreground sm:inline">
                  /
                </span>
                <span className="truncate font-medium">{activeItem.label}</span>
              </div>
            ) : (
              <span className="truncate text-sm font-medium">{topBarLabel}</span>
            )}

            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <UserMenu
                name={user.name}
                email={user.email}
                subtitle={roleLabel}
              />
            </div>
          </header>
          <main
            className={cn(
              "flex-1",
              // Full-bleed keeps a small inset on the sides and top so the stage
              // does not sit flush against the chrome; the bottom stays flush.
              fullBleed ? "px-4 pt-4" : "px-4 pt-6 pb-8 md:p-8",
            )}
          >
            <div
              className={cn(
                "w-full",
                !fullBleed && "mx-auto max-w-7xl space-y-6",
              )}
            >
              {children}
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
