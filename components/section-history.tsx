"use client";

// Per-section "who changed what" sheet. Fetches nothing until opened; reloads page 1 on every open.

import { useState } from "react";
import { History, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { getSectionHistory, type HistoryRow } from "@/lib/actions/section-history";
import { ROLE_LABELS } from "@/lib/members";
import { timeAgo } from "@/lib/format";
import type { HistorySection } from "@/lib/section-history";
import type { TenantRole } from "@/lib/roles";

export function SectionHistory({ section, className }: { section: HistorySection; className?: string }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(cursor?: string) {
    setPending(true);
    setError(null);
    try {
      const res = await getSectionHistory(section, cursor);
      if (!res.ok) return setError(res.error);
      setRows((prev) => (cursor && prev ? [...prev, ...res.rows] : res.rows));
      setNextCursor(res.nextCursor);
    } catch {
      setError("Couldn't load history.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open || pending) return;
        setRows(null);
        setNextCursor(null);
        load();
      }}
    >
      <SheetTrigger asChild>
        <Button variant="ghost" className={className}>
          <History className="size-4" /> History
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="gap-0">
        <SheetHeader className="border-b">
          <SheetTitle>History</SheetTitle>
          <SheetDescription>Who changed what in this section.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          {rows?.length === 0 && !error && <p className="text-sm text-muted-foreground">No changes yet.</p>}
          {rows && rows.length > 0 && (
            <ul className="space-y-4">
              {rows.map((r) => {
                const role = r.actorRole ? ROLE_LABELS[r.actorRole as TenantRole]?.label : undefined;
                return (
                  <li key={r.id} className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{r.actor}</span>
                      {role && <Badge variant="secondary">{role}</Badge>}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{timeAgo(r.at)}</span>
                    </div>
                    <div>
                      {r.action}
                      {r.target && <span className="text-muted-foreground"> · {r.target}</span>}
                    </div>
                    {r.changed?.length ? (
                      <div className="text-xs text-muted-foreground">{r.changed.join(", ")}</div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {pending && rows === null && (
            <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" aria-label="Loading" />
          )}
          {nextCursor && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4 w-full"
              disabled={pending}
              onClick={() => load(nextCursor)}
            >
              {pending ? "Loading…" : "Load more"}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
