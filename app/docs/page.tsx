// Public API reference (docs.maratus.co → rewritten here; /docs locally).
// Reading is public. "Try it" needs a sign-in: the page then mints a
// short-lived playground key for the user's organization (lib/playground-key.ts)
// so nobody pastes a real secret into a browser.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getPlaygroundContext } from "@/lib/actions/playground";
import { isDocsHost } from "@/lib/docs-host";
import { DocsReference } from "./docs-reference";

export const metadata: Metadata = {
  title: "Maratus API Reference",
  description:
    "Trigger in-store Maratus screens from your own systems: authentication, endpoints, errors and a live Try it console.",
};

export default async function DocsPage() {
  const [ctx, h] = await Promise.all([getPlaygroundContext(), headers()]);
  // On the docs host the page lives at "/", so sign-in returns there; locally
  // it's /docs on the console host.
  const loginHref = isDocsHost(h.get("host")) ? "/login?redirect=/" : "/login?redirect=/docs";
  return <DocsReference ctx={ctx} loginHref={loginHref} />;
}
