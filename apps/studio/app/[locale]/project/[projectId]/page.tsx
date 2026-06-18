import { redirect } from "next/navigation";
import { DEFAULT_MODE } from "@/app/[locale]/project/_modes/registry";

/** A bare project URL opens its default mode. */
export default async function ProjectIndexPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  redirect(`/${locale}/project/${projectId}/${DEFAULT_MODE}`);
}
