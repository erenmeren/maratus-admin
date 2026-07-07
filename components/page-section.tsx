import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/section-header";

export function PageSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {title && (
        <SectionHeader title={title} description={description}>
          {actions}
        </SectionHeader>
      )}
      {children}
    </section>
  );
}
