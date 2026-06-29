import Link from "next/link";
import { Check, Download, Leaf, FileText, SearchX, Mail, ExternalLink, RotateCcw, ShieldCheck } from "lucide-react";
import { DittoWordmark } from "@/components/brand";
import { getDocumentByToken, type PublicDocument } from "@/lib/documents";
import { supportLinks } from "@/lib/branding/support";
import { coverageStatus } from "@/lib/branding/coverage";
import { isValidHex } from "@/lib/color";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const document = await getDocumentByToken(token);

  if (!document) return <DocumentNotFound />;

  const accent = isValidHex(document.brandColor) ? document.brandColor : "#10A765";

  if (document.status === "pending" || !document.imageUrl) {
    return (
      <Shell brand={document}>
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
  const support = supportLinks(document);
  const coverage = coverageStatus(document, new Date());

  return (
    <Shell brand={document}>
      <div className="flex flex-col items-center gap-2 border-b px-6 py-6 text-center">
        <span
          className="flex size-11 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: accent }}
        >
          <Check className="size-6" />
        </span>
        <h1 className="font-display text-lg font-bold">Document ready</h1>
        <p className="text-xs text-muted-foreground">
          Issued by {document.organizationName}
          {document.storeName ? ` · ${document.storeName}` : ""}
        </p>
        {document.storeAddress && (
          <p className="text-xs text-muted-foreground">{document.storeAddress}</p>
        )}
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

      <div className="px-6 pb-4 pt-4">
        <a
          href={document.imageUrl}
          download
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: accent }}
        >
          <Download className="size-4" /> Download document
        </a>
      </div>

      {support.show && (
        <div className="border-t px-6 py-4 text-center text-xs text-muted-foreground">
          <p className="mb-1.5">
            Questions about this{document.storeName ? `? Contact ${document.storeName}` : "?"}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            {support.email && (
              <a href={`mailto:${support.email}`} className="inline-flex items-center gap-1 font-medium hover:underline">
                <Mail className="size-3.5" /> {support.email}
              </a>
            )}
            {support.url && (
              <a href={support.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline">
                <ExternalLink className="size-3.5" /> Return policy &amp; help
              </a>
            )}
          </div>
        </div>
      )}

      {coverage.show && (
        <div className="space-y-2 border-t px-6 py-4 text-center text-xs">
          {coverage.return && (
            <p className="flex items-center justify-center gap-1.5">
              <RotateCcw className="size-3.5" style={{ color: coverage.return.expired ? undefined : accent }} />
              {coverage.return.expired ? (
                <span className="text-muted-foreground">
                  Return period ended (was{" "}
                  {coverage.return.untilDate.toLocaleDateString("en-US", { dateStyle: "medium" })})
                </span>
              ) : (
                <span className="font-medium" style={{ color: accent }}>
                  Returns accepted until{" "}
                  {coverage.return.untilDate.toLocaleDateString("en-US", { dateStyle: "medium" })}
                </span>
              )}
            </p>
          )}
          {coverage.warranty && (
            <p className="flex items-center justify-center gap-1.5">
              <ShieldCheck className="size-3.5" style={{ color: coverage.warranty.expired ? undefined : accent }} />
              {coverage.warranty.expired ? (
                <span className="text-muted-foreground">
                  Warranty expired{" "}
                  {coverage.warranty.untilDate.toLocaleDateString("en-US", { year: "numeric", month: "short" })}
                </span>
              ) : (
                <span className="font-medium" style={{ color: accent }}>
                  Under warranty until{" "}
                  {coverage.warranty.untilDate.toLocaleDateString("en-US", { year: "numeric", month: "short" })}
                </span>
              )}
            </p>
          )}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, brand }: { children: React.ReactNode; brand?: Pick<PublicDocument, "logoUrl" | "organizationName"> }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex justify-center">
          {brand?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.organizationName} className="h-10 w-auto object-contain" />
          ) : brand?.organizationName ? (
            <span className="font-display text-lg font-bold">{brand.organizationName}</span>
          ) : null}
        </div>
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          {children}
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
        <Link href="/" className="text-sm font-medium text-primary hover:underline">
          Go to Ditto
        </Link>
      </div>
    </Shell>
  );
}
