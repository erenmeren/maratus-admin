import Link from "next/link";
import { Leaf, SearchX } from "lucide-react";
import { DittoWordmark } from "@/components/brand";

export function LookupShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex justify-center">
          <DittoWordmark subtle />
        </div>
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          {children}
        </div>
        <div className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Leaf className="size-3.5 text-primary" />
          <span className="inline-flex items-center gap-1">A paperless document, powered by</span>
          <DittoWordmark subtle />
        </div>
      </div>
    </div>
  );
}

export function LookupExpired({ orgId }: { orgId: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <SearchX className="size-6" />
      </span>
      <h1 className="font-display text-lg font-bold">Link expired</h1>
      <p className="max-w-xs text-sm text-muted-foreground">
        This link has expired or was already used.
      </p>
      <Link
        href={`/d/lookup/${orgId}`}
        className="text-sm font-medium text-primary hover:underline"
      >
        Request a new link
      </Link>
    </div>
  );
}
