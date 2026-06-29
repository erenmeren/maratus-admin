"use client";

import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { saveCoverageWindow } from "@/app/(tenant)/tenant/branding/coverage-actions";

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

  async function action(formData: FormData) {
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
        <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
            />
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
            />
          </label>
          {canEdit && (
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
