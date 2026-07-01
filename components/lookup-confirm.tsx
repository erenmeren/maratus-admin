"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { confirmLookup } from "@/app/(public)/d/lookup/actions";
import { LookupShell, LookupExpired } from "@/components/lookup-shell";
import { LookupDocumentList } from "@/components/lookup-document-list";

type ConfirmResult = Awaited<ReturnType<typeof confirmLookup>>;

export function LookupConfirm({ orgId, token }: { orgId: string; token: string }) {
  const [result, setResult] = React.useState<ConfirmResult | null>(null);
  const [pending, startTransition] = React.useTransition();

  function onConfirm() {
    const formData = new FormData();
    formData.set("orgId", orgId);
    formData.set("token", token);
    startTransition(async () => {
      const res = await confirmLookup(formData);
      setResult(res);
    });
  }

  if (result === null) {
    return (
      <LookupShell>
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <h1 className="font-display text-lg font-bold">Find your documents</h1>
          <p className="max-w-xs text-sm text-muted-foreground">
            Your saved documents from this merchant are ready to view.
          </p>
          <Button onClick={onConfirm} disabled={pending} className="mt-2">
            {pending ? "Loading…" : "View my documents"}
          </Button>
        </div>
      </LookupShell>
    );
  }

  if (result.ok) {
    return (
      <LookupShell>
        <LookupDocumentList email={result.email} documents={result.documents} />
      </LookupShell>
    );
  }

  return (
    <LookupShell>
      <LookupExpired orgId={orgId} />
    </LookupShell>
  );
}
