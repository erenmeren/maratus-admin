"use client";

import { useRouter } from "next/navigation";
import { LogOut, Settings, UserRound } from "lucide-react";
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
  name = "Eren Altan",
  email = "erenaltan@gmail.com",
}: {
  name?: string;
  email?: string;
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
          className="h-9 gap-2 px-1.5 pr-2.5"
          aria-label="Account menu"
        >
          <Avatar className="size-7">
            <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium sm:inline">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="text-sm font-medium">{name}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <UserRound className="size-4" /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Settings className="size-4" /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/login")}>
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
