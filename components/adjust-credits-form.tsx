"use client";

import { useActionState } from "react";
import { adjustCreditsAction, type GrantState } from "@/lib/actions/credits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: GrantState = { ok: false };

export function AdjustCreditsForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(adjustCreditsAction, initialState);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-col gap-1">
        <Label className="text-xs font-medium text-muted-foreground">Direction</Label>
        <div className="flex h-9 items-center gap-4 text-sm">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="radio" name="direction" value="grant" defaultChecked /> Add
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="radio" name="direction" value="deduct" /> Deduct
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="credits-amount" className="text-xs font-medium text-muted-foreground">
          Credits
        </Label>
        <Input
          id="credits-amount"
          name="credits"
          type="number"
          min={1}
          max={1000000}
          step={1}
          required
          placeholder="e.g. 100"
          className="h-9 w-36 tabular-nums"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="credits-note" className="text-xs font-medium text-muted-foreground">
          Note (optional)
        </Label>
        <Input
          id="credits-note"
          name="note"
          type="text"
          placeholder="e.g. invoice #42 unpaid"
          className="h-9 w-56"
        />
      </div>

      <Button type="submit" disabled={pending} className="h-9">
        {pending ? "Applying…" : "Apply"}
      </Button>

      {state.error && (
        <p className="w-full text-sm text-destructive">{state.error}</p>
      )}
      {state.ok && (
        <p className="w-full text-sm text-green-600 dark:text-green-400">Credits updated.</p>
      )}
    </form>
  );
}
