"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getTenantStoreOptionsAction } from "@/lib/actions/devices";

/**
 * Searchable store picker; options load lazily on first open.
 *
 * Deliberately NOT a `<Select>` — at fleet scale (thousands of stores) the
 * picker needs its own typeahead filter rather than a native/Radix listbox.
 * `components/ui/command.tsx` isn't in this repo, so this is a plain `Input`
 * filter over a scrollable list instead of the shadcn `Command` family.
 */
export function StorePickerDialog({
  open,
  onOpenChange,
  title,
  excludeStoreId,
  onPick,
  pending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  excludeStoreId?: string | null;
  onPick: (storeId: string) => void;
  pending: boolean;
}) {
  const [options, setOptions] = React.useState<{ id: string; name: string }[] | null>(null);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (open && options === null) {
      getTenantStoreOptionsAction().then(setOptions).catch(() => setOptions([]));
    }
  }, [open, options]);

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const visible = (options ?? [])
    .filter((o) => o.id !== excludeStoreId)
    .filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stores…"
          autoFocus
        />
        <div className="max-h-64 overflow-y-auto rounded-md border">
          {options === null ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Loading stores…</p>
          ) : visible.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">No stores found.</p>
          ) : (
            <ul className="divide-y">
              {visible.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onPick(o.id)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                  >
                    {o.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
