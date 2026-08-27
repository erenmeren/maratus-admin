import { redirect } from "next/navigation";
import { getContext } from "@/lib/session";

export default async function Home() {
  // Send signed-in users straight to their workspace.
  const ctx = await getContext();
  if (ctx?.user) {
    redirect(ctx.user.role === "platform_admin" ? "/admin" : "/tenant");
  }

  redirect("/login");
}
