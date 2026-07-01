import { Leaf } from "lucide-react";
import { DittoWordmark } from "@/components/brand";
import { LookupRequestForm } from "@/components/lookup-request-form";

export default async function Page({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex justify-center">
          <DittoWordmark subtle />
        </div>
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b px-6 py-6 text-center">
            <h1 className="font-display text-lg font-bold">Find your documents</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter the email you used and we&apos;ll send you a link to your documents.
            </p>
          </div>
          <LookupRequestForm orgId={orgId} />
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
