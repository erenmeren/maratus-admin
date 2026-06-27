import Link from "next/link";
import { Check, Download, Leaf, FileText, SearchX } from "lucide-react";
import { DittoWordmark } from "@/components/brand";
import { getDocumentByToken } from "@/lib/documents";

// Public document page — what a customer sees after scanning the printer QR.
// No auth: the token IS the capability (long + unguessable). Viewing a ready
// document flips it to "downloaded" (the "document sent ✓" signal).
export default async function DocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const document = await getDocumentByToken(token);

  if (!document) return <DocumentNotFound />;

  if (document.status === "pending" || !document.imageUrl) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FileText className="size-6" />
          </span>
          <h1 className="font-display text-lg font-bold">Almost ready</h1>
          <p className="max-w-xs text-sm text-muted-foreground">
            Your document is still being prepared. Refresh in a moment.
          </p>
        </div>
      </Shell>
    );
  }

  const dateStr = document.createdAt.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <Shell>
      <div className="flex flex-col items-center gap-2 border-b bg-primary/5 px-6 py-6 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-status-online/15 text-status-online">
          <Check className="size-6" />
        </span>
        <h1 className="font-display text-lg font-bold">Document ready</h1>
        <p className="text-xs text-muted-foreground">
          {document.organizationName}
          {document.storeName ? ` · ${document.storeName}` : ""}
        </p>
        <p className="text-xs text-muted-foreground">{dateStr}</p>
      </div>

      {/* Rendered document image from R2 (short-lived presigned URL) */}
      <div className="bg-muted/30 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={document.imageUrl}
          alt="Your document"
          className="mx-auto w-full max-w-xs rounded-lg border bg-white shadow-sm"
        />
      </div>

      <div className="px-6 pb-6 pt-4">
        <a
          href={document.imageUrl}
          download
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Download className="size-4" /> Download document
        </a>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
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
          A paperless document, powered by Ditto.
        </div>
      </div>
    </div>
  );
}

function DocumentNotFound() {
  return (
    <Shell>
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <SearchX className="size-6" />
        </span>
        <h1 className="font-display text-lg font-bold">Document not found</h1>
        <p className="max-w-xs text-sm text-muted-foreground">
          This link is invalid or has expired. Ask the store to re-issue your
          document.
        </p>
        <Link
          href="/"
          className="text-sm font-medium text-primary hover:underline"
        >
          Go to Ditto
        </Link>
      </div>
    </Shell>
  );
}
