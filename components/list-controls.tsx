"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Debounced search box + optional status pill tabs. All state lives in the
 *  URL (?q=&status=&page=); changing either resets the page. */
export function ListControls({
  initialQ,
  placeholder,
  tabs,
}: {
  initialQ: string;
  placeholder: string;
  tabs?: { value: string; label: string; count: number; active: boolean }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = React.useState(initialQ);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pending debounce firing after unmount would router.replace the user
  // back to this list page — clear it on the way out.
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const apply = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      next.delete("page"); // any filter change restarts at page 1
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
    },
    [router, pathname, searchParams],
  );

  function onChange(v: string) {
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply({ q: v.trim() }), 300);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-full md:max-w-xs">
        <Search aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 stroke-[1.6] text-muted-foreground" />
        <Input
          value={value}
          placeholder={placeholder}
          aria-label={placeholder.replace(/…$/, "")}
          className="pl-[34px]"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (timer.current) clearTimeout(timer.current);
              apply({ q: value.trim() });
            }
          }}
        />
      </div>
      {tabs && (
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-0.5 rounded-lg border bg-field p-0.5 max-sm:w-full max-sm:flex-nowrap max-sm:justify-between max-sm:gap-0 max-sm:overflow-x-auto max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => {
                if (timer.current) clearTimeout(timer.current);
                apply({ status: t.value === "all" ? null : t.value, q: value.trim() });
              }}
              aria-pressed={t.active}
              className={cn(
                "h-[26px] rounded-[5px] px-2.5 text-[13px] whitespace-nowrap tabular-nums transition-colors duration-[120ms] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-sm:px-[5px] max-sm:text-xs max-sm:tracking-[-0.01em]",
                t.active
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label} · {t.count}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
