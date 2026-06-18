import { notFound } from "next/navigation";
import { getMode } from "@/app/[locale]/project/_modes/registry";

/**
 * Mounts the active mode's editor (a client component). The editor reads the
 * project from ProjectContext (provided by the shell layout); an unknown mode
 * 404s via the canonical server-component path.
 */
export default async function ModePage({ params }: { params: Promise<{ mode: string }> }) {
  const { mode } = await params;
  const studioMode = getMode(mode);
  if (!studioMode) notFound();
  const Editor = studioMode.Editor;
  return <Editor />;
}
