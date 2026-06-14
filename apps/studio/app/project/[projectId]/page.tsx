import { redirect } from "next/navigation";
import { DEFAULT_MODE } from "@/app/project/_modes/registry";

/** A bare project URL opens its default mode. */
export default async function ProjectIndexPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/project/${projectId}/${DEFAULT_MODE}`);
}
