import { Check, Download, Leaf } from "lucide-react";
import { DittoWordmark } from "@/components/brand";

// Stub public receipt page — what a customer sees after scanning the kiosk QR.
// TODO: replace with API — fetch the real receipt by token.
export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex justify-center">
          <DittoWordmark subtle />
        </div>

        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-col items-center gap-2 border-b bg-primary/5 px-6 py-6 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-status-online/15 text-status-online">
              <Check className="size-6" />
            </span>
            <h1 className="font-display text-lg font-bold">Receipt ready</h1>
            <p className="text-xs text-muted-foreground">
              Roastwell Coffee · Downtown Flagship
            </p>
          </div>

          <div className="space-y-3 px-6 py-5 text-sm">
            {[
              ["Oat Flat White", "$5.25"],
              ["Almond Croissant", "$4.10"],
              ["Sparkling Water", "$2.50"],
            ].map(([item, price]) => (
              <div key={item} className="flex justify-between">
                <span className="text-muted-foreground">{item}</span>
                <span className="font-medium tabular-nums">{price}</span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-3 font-display text-base font-bold">
              <span>Total</span>
              <span className="tabular-nums">$11.85</span>
            </div>
          </div>

          <div className="px-6 pb-6">
            <button className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground">
              <Download className="size-4" /> Download PDF
            </button>
          </div>
        </div>

        <div className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Leaf className="size-3.5 text-primary" />
          You just saved a paper receipt. Token{" "}
          <code className="rounded bg-muted px-1 font-mono">{token}</code>
        </div>
      </div>
    </div>
  );
}
