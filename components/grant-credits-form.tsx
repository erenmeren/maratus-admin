"use client";

import { useActionState } from "react";
import { grantCreditsAction, type GrantState } from "@/lib/actions/credits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: GrantState = { ok: false };

export function GrantCreditsForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(grantCreditsAction, initialState);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

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
          placeholder="e.g. promotional grant"
          className="h-9 w-56"
        />
      </div>

      <Button type="submit" disabled={pending} className="h-9">
        {pending ? "Granting…" : "Grant credits"}
      </Button>

      {state.error && (
        <p className="w-full text-sm text-destructive">{state.error}</p>
      )}
      {state.ok && (
        <p className="w-full text-sm text-green-600 dark:text-green-400">Credits granted.</p>
      )}
    </form>
  );
}
