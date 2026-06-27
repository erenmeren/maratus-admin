import Link from "next/link";
import type { DocumentListRow } from "@/lib/data";

export function DocumentsTable({
  rows,
  page,
  pageCount,
  basePath,
  query,
}: {
  rows: DocumentListRow[];
  page: number;
  pageCount: number;
  basePath: string;
  query: string;
}) {
  function pageHref(p: number) {
    const q = new URLSearchParams(query);
    q.set("page", String(p));
    return `${basePath}?${q.toString()}`;
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No documents match these filters.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-2">Created</th>
            <th>Store</th>
            <th>Device</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="py-2">{r.createdAt.slice(0, 19).replace("T", " ")}</td>
              <td>{r.storeName ?? "—"}</td>
              <td>{r.deviceName ?? "—"}</td>
              <td>{r.status}</td>
              <td className="text-right">
                <Link className="underline" href={`${basePath}/${r.id}`}>View</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Page {page} of {pageCount}</span>
        <span className="flex gap-3">
          {page > 1 ? <Link className="underline" href={pageHref(page - 1)}>Previous</Link> : <span className="text-muted-foreground">Previous</span>}
          {page < pageCount ? <Link className="underline" href={pageHref(page + 1)}>Next</Link> : <span className="text-muted-foreground">Next</span>}
        </span>
      </div>
    </div>
  );
}
