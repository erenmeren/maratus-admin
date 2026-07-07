import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  badge,
  leading,
  backHref,
  backLabel,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  leading?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {backHref && (
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {backLabel}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          {leading}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-bold tracking-tight">
                {title}
              </h1>
              {badge}
            </div>
            {description && (
              <div className="text-sm text-muted-foreground">{description}</div>
            )}
          </div>
        </div>
        {children && <div className="flex items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}
