import { notFound } from "next/navigation";
import { getMode } from "@/app/[locale]/project/_modes/registry";

/**
 * Validates the mode route. Editors are mounted by the persistent project
 * layout so their DOM and local state survive switching between modes.
 */
export default async function ModePage({ params }: { params: Promise<{ mode: string }> }) {
  const { mode } = await params;
  if (!getMode(mode)) notFound();
  return null;
}
