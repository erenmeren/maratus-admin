"use client";

import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Shield, Store } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { DittoMark } from "@/components/brand";
import { authClient } from "@/lib/auth-client";
import type { OrgRef } from "@/lib/session";
import { cn } from "@/lib/utils";

export type Workspace = "admin" | "tenant";

export function WorkspaceSwitcher({
  active,
  role,
  organizations,
  activeName,
  activeOrganizationId,
}: {
  active: Workspace;
  role: string;
  organizations: OrgRef[];
  activeName: string;
  activeOrganizationId: string | null;
}) {
  const router = useRouter();
  const isPlatformAdmin = role === "platform_admin";

  const headerName = active === "admin" ? "Ditto HQ" : activeName;
  const headerRole = active === "admin" ? "Super Admin" : "Tenant Workspace";

  async function switchOrg(orgId: string) {
    if (orgId !== activeOrganizationId) {
      await authClient.organization.setActive({ organizationId: orgId });
    }
    router.push("/tenant");
    router.refresh();
  }

  const multi = organizations.length > 1 || isPlatformAdmin;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent"
            >
              <DittoMark className="size-7" />
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-display text-sm font-semibold">
                  {headerName}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {headerRole}
                </span>
              </div>
              {multi && <ChevronsUpDown className="ml-auto size-4 opacity-60" />}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-60"
          >
            {isPlatformAdmin && (
              <>
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Platform
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => router.push("/admin")}
                  className="gap-2 py-2"
                >
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-md border",
                      active === "admin"
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Shield className="size-4" />
                  </span>
                  <div className="grid flex-1 leading-tight">
                    <span className="text-sm font-medium">Ditto HQ</span>
                    <span className="text-xs text-muted-foreground">
                      Super Admin
                    </span>
                  </div>
                  {active === "admin" && <Check className="size-4 text-primary" />}
                </DropdownMenuItem>
                {organizations.length > 0 && <DropdownMenuSeparator />}
              </>
            )}

            {organizations.length > 0 && (
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {organizations.length > 1 ? "Organizations" : "Workspace"}
              </DropdownMenuLabel>
            )}
            {organizations.map((o) => {
              const isCurrent =
                active === "tenant" && o.id === activeOrganizationId;
              return (
                <DropdownMenuItem
                  key={o.id}
                  onClick={() => switchOrg(o.id)}
                  className="gap-2 py-2"
                >
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-md border",
                      isCurrent
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Store className="size-4" />
                  </span>
                  <div className="grid flex-1 leading-tight">
                    <span className="truncate text-sm font-medium">{o.name}</span>
                    <span className="text-xs text-muted-foreground capitalize">
                      {o.role}
                    </span>
                  </div>
                  {isCurrent && <Check className="size-4 text-primary" />}
                </DropdownMenuItem>
              );
            })}

            {!isPlatformAdmin && organizations.length === 0 && (
              <DropdownMenuItem
                disabled
                onClick={() => toast.info("No workspaces yet")}
              >
                No workspaces
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
