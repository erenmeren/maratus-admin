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
import { MaratusMark } from "@/components/brand";
import { authClient } from "@/lib/auth-client";
import type { OrgRef } from "@/lib/session";

// The current workspace's tick keeps the accent even while its row is focused
// (the dropdown item otherwise sets every child to the text colour).
const CHECK = "size-4 text-primary! group-focus/dropdown-menu-item:text-primary!";

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

  const headerName = active === "admin" ? "Maratus HQ" : activeName;
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
              className="h-10 gap-2.5 transition-[width,height,padding,background-color] duration-[120ms] hover:bg-hover active:bg-hover data-[state=open]:bg-hover data-open:hover:bg-hover group-data-[collapsible=icon]:justify-center"
            >
              {/* size-auto!: the menu button would otherwise force every svg to 16px */}
              <MaratusMark className="h-[26px]! w-auto! group-data-[collapsible=icon]:h-5!" />
              <div className="grid flex-1 text-left group-data-[collapsible=icon]:hidden">
                <span className="truncate font-display text-sm leading-4 font-semibold tracking-[-0.005em]">
                  {headerName}
                </span>
                <span className="truncate text-xs leading-4 text-muted-foreground">
                  {headerRole}
                </span>
              </div>
              {multi && (
                <ChevronsUpDown className="ml-auto size-3.5 stroke-[1.6] text-muted-foreground group-data-[collapsible=icon]:hidden" />
              )}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-60"
          >
            {isPlatformAdmin && (
              <>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Platform
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => router.push("/admin")}
                  className="py-2"
                >
                  <Shield className="size-4 stroke-[1.6]" />
                  <div className="grid min-w-0 flex-1">
                    <span className="text-sm leading-[18px] font-medium">Maratus HQ</span>
                    <span className="text-xs leading-4 text-muted-foreground">
                      Super Admin
                    </span>
                  </div>
                  {active === "admin" && <Check className={CHECK} />}
                </DropdownMenuItem>
                {organizations.length > 0 && <DropdownMenuSeparator />}
              </>
            )}

            {organizations.length > 0 && (
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
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
                  className="py-2"
                >
                  <Store className="size-4 stroke-[1.6]" />
                  <div className="grid min-w-0 flex-1">
                    <span className="truncate text-sm leading-[18px] font-medium">{o.name}</span>
                    <span className="text-xs leading-4 text-muted-foreground capitalize">
                      {o.role}
                    </span>
                  </div>
                  {isCurrent && <Check className={CHECK} />}
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
