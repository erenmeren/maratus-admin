"use client";

import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Shield, Store } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { DittoMark } from "@/components/brand";
import { cn } from "@/lib/utils";

export type Workspace = "admin" | "tenant";

const WORKSPACES = [
  {
    key: "admin" as const,
    name: "Ditto HQ",
    role: "Super Admin",
    href: "/admin",
    icon: Shield,
  },
  {
    key: "tenant" as const,
    name: "Roastwell Coffee",
    role: "Tenant Workspace",
    href: "/tenant",
    icon: Store,
  },
];

export function WorkspaceSwitcher({ active }: { active: Workspace }) {
  const router = useRouter();
  const current = WORKSPACES.find((w) => w.key === active) ?? WORKSPACES[0];

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
                  {current.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {current.role}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 opacity-60" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-60"
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Switch workspace
            </DropdownMenuLabel>
            {WORKSPACES.map((w) => (
              <DropdownMenuItem
                key={w.key}
                onClick={() => router.push(w.href)}
                className="gap-2 py-2"
              >
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md border",
                    w.key === active
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <w.icon className="size-4" />
                </span>
                <div className="grid flex-1 leading-tight">
                  <span className="text-sm font-medium">{w.name}</span>
                  <span className="text-xs text-muted-foreground">{w.role}</span>
                </div>
                {w.key === active && <Check className="size-4 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
