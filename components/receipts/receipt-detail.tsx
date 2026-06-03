import { env } from "@/lib/env";

type Detail = {
  id: string;
  token: string;
  status: string;
  storeName: string | null;
  deviceName: string | null;
  byteSize: number;
  createdAt: string;
  downloadedAt: string | null;
  imageUrl: string | null;
};

export function ReceiptDetail({ receipt }: { receipt: Detail }) {
  const publicUrl = `${env.BETTER_AUTH_URL}/r/${receipt.token}`;
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:max-w-md">
        <dt className="text-muted-foreground">Store</dt><dd>{receipt.storeName ?? "—"}</dd>
        <dt className="text-muted-foreground">Device</dt><dd>{receipt.deviceName ?? "—"}</dd>
        <dt className="text-muted-foreground">Status</dt><dd>{receipt.status}</dd>
        <dt className="text-muted-foreground">Created</dt><dd>{receipt.createdAt.slice(0, 19).replace("T", " ")}</dd>
        <dt className="text-muted-foreground">Downloaded</dt><dd>{receipt.downloadedAt ? receipt.downloadedAt.slice(0, 19).replace("T", " ") : "—"}</dd>
        <dt className="text-muted-foreground">Size</dt><dd>{(receipt.byteSize / 1024).toFixed(1)} KB</dd>
        <dt className="text-muted-foreground">Public link</dt>
        <dd><a className="underline break-all" href={publicUrl} target="_blank" rel="noreferrer">{publicUrl}</a></dd>
      </dl>
      {receipt.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={receipt.imageUrl} alt="Receipt" className="max-w-sm rounded-lg border" />
      ) : (
        <p className="text-sm text-muted-foreground">Image not available yet.</p>
      )}
    </div>
  );
}
