import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MaratusWordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 text-center">
      <MaratusWordmark />
      <div className="space-y-2">
        <p className="font-display text-6xl font-bold tracking-tight text-primary">
          404
        </p>
        <h1 className="font-display text-xl font-bold">Page not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          This page has gone fully paperless — there&apos;s nothing here.
        </p>
      </div>
      <div className="flex gap-2">
        <Button asChild variant="outline">
          <Link href="/tenant">
            <ArrowLeft className="size-4" /> Tenant workspace
          </Link>
        </Button>
        <Button asChild>
          <Link href="/admin">Super Admin</Link>
        </Button>
      </div>
    </div>
  );
}
