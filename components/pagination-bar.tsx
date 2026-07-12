import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZE, pageCount } from "@/lib/list-params";
import { cn } from "@/lib/utils";

/** Link-based pager (works without JS). Hidden when everything fits one page. */
export function PaginationBar({
  page,
  total,
  pageSize = PAGE_SIZE,
  pathname,
  params,
}: {
  page: number;
  total: number;
  pageSize?: number;
  pathname: string;
  params: Record<string, string>;
}) {
  const pages = pageCount(total, pageSize);
  if (pages <= 1) return null;

  const href = (p: number) => {
    const next = new URLSearchParams(params);
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const linkCls = (disabled: boolean) =>
    cn(
      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm",
      disabled ? "pointer-events-none text-muted-foreground/40" : "hover:bg-muted",
    );

  return (
    <nav className="flex items-center justify-between text-sm text-muted-foreground" aria-label="Pagination">
      <Link href={href(page - 1)} className={linkCls(page <= 1)} aria-disabled={page <= 1}>
        <ChevronLeft className="size-4" /> Previous
      </Link>
      <span className="tabular-nums">
        Page {page} of {pages} · {total.toLocaleString()} total
      </span>
      <Link href={href(page + 1)} className={linkCls(page >= pages)} aria-disabled={page >= pages}>
        Next <ChevronRight className="size-4" />
      </Link>
    </nav>
  );
}
