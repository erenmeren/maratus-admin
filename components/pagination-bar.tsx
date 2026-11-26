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
      "-mx-2 inline-flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors duration-[120ms] [&_svg]:stroke-[1.6]",
      disabled ? "pointer-events-none text-disabled-foreground" : "text-foreground hover:bg-hover",
    );

  return (
    <nav className="flex items-center justify-between text-[13px] text-muted-foreground" aria-label="Pagination">
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
