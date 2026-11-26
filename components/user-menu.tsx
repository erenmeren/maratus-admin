"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, KeyRound, LogOut } from "lucide-react";
import { signOut } from "@/lib/auth-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
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
  const [passwordOpen, setPasswordOpen] = React.useState(false);
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-10 gap-2.5 px-2"
            aria-label="Account menu"
          >
            <span className="relative">
              <Avatar className="size-7 after:hidden">
                <AvatarFallback className="bg-avatar text-xs font-medium tracking-normal text-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {/* Live-session dot — a small "you're online" tell. */}
              <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background bg-status-online" />
            </span>
            <span className="hidden flex-col items-start sm:flex">
              <span className="text-[13px] leading-4 font-medium">{name}</span>
              <span className="text-xs leading-4 font-normal text-muted-foreground">
                {subtitle}
              </span>
            </span>
            <ChevronsUpDown className="hidden size-3.5 stroke-[1.6] text-muted-foreground sm:block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="flex items-center gap-2.5 p-2">
            <Avatar className="size-9 after:hidden">
              <AvatarFallback className="bg-avatar text-[13px] font-medium tracking-normal text-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm leading-[18px] font-medium">{name}</span>
              <span className="truncate text-xs leading-4 font-normal text-muted-foreground">
                {email}
              </span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setPasswordOpen(true);
            }}
          >
            <KeyRound className="size-4 stroke-[1.6]" /> Change password
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={async () => {
              // Destroy the session first; a bare router.push leaves the cookie
              // alive and the login page bounces a signed-in user right back.
              await signOut();
              router.push("/login");
              router.refresh();
            }}
          >
            <LogOut className="size-4 stroke-[1.6]" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />
    </>
  );
}
