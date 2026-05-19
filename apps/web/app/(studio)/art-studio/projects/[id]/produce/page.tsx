import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { projectWorkspaceRoute } from "@/src/lib/studio-routes";

/**
 * Produce index — bare URL has no real content of its own; we send
 * the user to Step 1 (script). Once we have project-state-aware
 * routing (e.g. resume on the most recently incomplete step) this
 * becomes a server lookup that picks the right step.
 *
 * Server component so the redirect happens before render — no client
 * flash of the wrong screen.
 */
export default async function ProduceIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hdrs = await headers();
  const locale = hdrs.get("x-locale") ?? "en-US";
  redirect(`/${locale}${projectWorkspaceRoute(id, { suffix: "/produce/script" })}`);
}
