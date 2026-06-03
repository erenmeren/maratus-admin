import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/session";
import { getReceiptDetail } from "@/lib/data";
import { ReceiptDetail } from "@/components/receipts/receipt-detail";

export default async function AdminReceiptDetailPage({
  params,
}: {
  params: Promise<{ receiptId: string }>;
}) {
  await requirePlatformAdmin();
  const { receiptId } = await params;
  const receipt = await getReceiptDetail(receiptId, {});
  if (!receipt) notFound();

  return (
    <div className="flex flex-col gap-6 p-6">
      <Link className="text-sm underline" href="/admin/receipts">← Back to receipts</Link>
      <h1 className="text-2xl font-semibold tracking-tight">Receipt</h1>
      <ReceiptDetail receipt={receipt} />
    </div>
  );
}
