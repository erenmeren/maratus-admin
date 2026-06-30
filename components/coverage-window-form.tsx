"use client";

import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { saveCoverageWindow } from "@/app/(tenant)/tenant/branding/coverage-actions";
import { isValidWindowDays, isValidWarrantyMonths } from "@/lib/branding/coverage";

type FieldErrors = { returnWindowDays?: string; warrantyPeriodMonths?: string };

const RETURN_ERROR = "Enter a whole number of days from 1 to 3650, or leave blank.";
const WARRANTY_ERROR = "Enter a whole number of months from 1 to 120, or leave blank.";

/** Mirror the server's parse + range check so out-of-range input is caught visibly. */
function fieldError(raw: string, isValid: (n: number) => boolean, message: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined; // blank is allowed (hides the window)
  if (!/^\d+$/.test(s) || !isValid(Number(s))) return message;
  return undefined;
}

export function CoverageWindowForm({
  initialReturnDays,
  initialWarrantyMonths,
  canEdit,
}: {
  initialReturnDays: number | null;
  initialWarrantyMonths: number | null;
  canEdit: boolean;
}) {
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});

  async function action(formData: FormData) {
    const next: FieldErrors = {
      returnWindowDays: fieldError(
        String(formData.get("returnWindowDays") ?? ""),
        isValidWindowDays,
        RETURN_ERROR,
      ),
      warrantyPeriodMonths: fieldError(
        String(formData.get("warrantyPeriodMonths") ?? ""),
        isValidWarrantyMonths,
        WARRANTY_ERROR,
      ),
    };
    if (next.returnWindowDays || next.warrantyPeriodMonths) {
      setErrors(next);
      toast.error("Couldn't save", { description: "Fix the highlighted fields." });
      return;
    }

    setErrors({});
    setPending(true);
    const res = await saveCoverageWindow(formData);
    setPending(false);
    if (res.ok) toast.success("Return & warranty window saved");
    else toast.error("Couldn't save", { description: res.error });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Return &amp; warranty window</CardTitle>
        <CardDescription>
          Optional. Shown to customers on the document page as a return deadline and
          warranty expiry, counted from when the document was issued. Leave blank to hide.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={action}
          noValidate
          className="flex flex-col gap-3 sm:flex-row sm:items-start"
        >
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-muted-foreground">Return window (days)</span>
            <Input
              name="returnWindowDays"
              type="number"
              min={1}
              max={3650}
              defaultValue={initialReturnDays ?? ""}
              placeholder="30"
              disabled={!canEdit}
              aria-invalid={errors.returnWindowDays ? true : undefined}
              onChange={() => setErrors((e) => ({ ...e, returnWindowDays: undefined }))}
            />
            {errors.returnWindowDays && (
              <span className="mt-1 block text-destructive">{errors.returnWindowDays}</span>
            )}
          </label>
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-muted-foreground">Warranty (months)</span>
            <Input
              name="warrantyPeriodMonths"
              type="number"
              min={1}
              max={120}
              defaultValue={initialWarrantyMonths ?? ""}
              placeholder="12"
              disabled={!canEdit}
              aria-invalid={errors.warrantyPeriodMonths ? true : undefined}
              onChange={() => setErrors((e) => ({ ...e, warrantyPeriodMonths: undefined }))}
            />
            {errors.warrantyPeriodMonths && (
              <span className="mt-1 block text-destructive">{errors.warrantyPeriodMonths}</span>
            )}
          </label>
          {canEdit && (
            <Button type="submit" disabled={pending} className="sm:mt-6">
              {pending ? "Saving…" : "Save"}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
