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
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { WorkspaceSwitcher, type Workspace } from "@/components/workspace-switcher";
import { ADMIN_NAV, TENANT_NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string) {
  if (href === "/admin" || href === "/tenant") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppShell({
  workspace,
  groupLabel,
  topBarLabel,
  children,
}: {
  workspace: Workspace;
  groupLabel: string;
  topBarLabel: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Nav lives inside the client boundary so we never pass icon components
  // (functions) across the server→client edge.
  const nav = workspace === "admin" ? ADMIN_NAV : TENANT_NAV;

  return (
    <TooltipProvider>
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <WorkspaceSwitcher active={workspace} />
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
            <p className="mt-0.5">Every QR scan is a receipt that never printed.</p>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-sm">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 !h-5" />
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-xs font-semibold",
              workspace === "admin"
                ? "bg-foreground/10 text-foreground"
                : "bg-primary/12 text-primary",
            )}
          >
            {topBarLabel}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <Separator orientation="vertical" className="mx-1 !h-5" />
            <UserMenu />
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
