"use client";

import { useRouter } from "next/navigation";
import { ChevronsUpDown, LogOut } from "lucide-react";
import { signOut } from "@/lib/auth-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({
  name,
  email,
  subtitle = "Account",
}: {
  name: string;
  email: string;
  /** Short role caption shown under the name (e.g. "Owner", "Super Admin"). */
  subtitle?: string;
}) {
  const router = useRouter();
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-10 gap-2 rounded-xl px-1.5 pr-2 hover:bg-muted/70"
          aria-label="Account menu"
        >
          <span className="relative">
            <Avatar className="size-7 ring-2 ring-primary/25">
              <AvatarFallback className="bg-primary/15 text-[11px] font-bold text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            {/* Live-session dot — a small "you're online" tell. */}
            <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background bg-status-online" />
          </span>
          <span className="hidden flex-col items-start leading-tight sm:flex">
            <span className="text-xs font-semibold">{name}</span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {subtitle}
            </span>
          </span>
          <ChevronsUpDown className="hidden size-3.5 text-muted-foreground/60 sm:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-2.5 p-2">
          <Avatar className="size-9 ring-2 ring-primary/20">
            <AvatarFallback className="bg-primary/15 text-xs font-bold text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">{name}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">
              {email}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            // Destroy the session first; a bare router.push leaves the cookie
            // alive and the login page bounces a signed-in user right back.
            await signOut();
            router.push("/login");
            router.refresh();
          }}
        >
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
