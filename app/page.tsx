import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/session";
import { Button } from "@/components/ui/button";

export default async function Home() {
  // Send signed-in users straight to their workspace.
  const ctx = await getContext();
  if (ctx?.user) {
    redirect(ctx.user.role === "platform_admin" ? "/admin" : "/tenant");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Paper documents, gone.
        </h1>
        <p className="max-w-md text-lg text-muted-foreground">
          Ditto turns every checkout into a QR code your customers scan for an
          instant digital document. Manage your stores, devices, and billing from
          one console.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link href="/signup">Start free</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}
