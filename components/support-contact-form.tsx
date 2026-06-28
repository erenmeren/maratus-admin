"use client";

import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { saveSupportContact } from "@/app/(tenant)/tenant/branding/support-actions";

export function SupportContactForm({
  initialEmail,
  initialUrl,
  canEdit,
}: {
  initialEmail: string | null;
  initialUrl: string | null;
  canEdit: boolean;
}) {
  const [pending, setPending] = React.useState(false);

  async function action(formData: FormData) {
    setPending(true);
    const res = await saveSupportContact(formData);
    setPending(false);
    if (res.ok) toast.success("Support contact saved");
    else toast.error("Couldn't save", { description: res.error });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Customer support contact</CardTitle>
        <CardDescription>
          Optional. Shown to customers on the document page they scan. Leave blank to hide.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-muted-foreground">Support email</span>
            <Input name="supportEmail" type="email" defaultValue={initialEmail ?? ""} placeholder="help@yourstore.com" disabled={!canEdit} />
          </label>
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-muted-foreground">Return policy / help URL</span>
            <Input name="supportUrl" type="url" defaultValue={initialUrl ?? ""} placeholder="https://yourstore.com/returns" disabled={!canEdit} />
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
