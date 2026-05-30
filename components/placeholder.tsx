import { Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

export function Placeholder({
  title,
  description,
  note = "Coming in the next build phase.",
}: {
  title: string;
  description?: string;
  note?: string;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-accent text-muted-foreground">
            <Construction className="size-6" />
          </span>
          <p className="text-sm font-medium">{note}</p>
        </CardContent>
      </Card>
    </>
  );
}
