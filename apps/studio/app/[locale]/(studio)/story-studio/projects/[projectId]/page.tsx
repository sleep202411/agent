import { redirect } from "next/navigation";

export default async function StoryProjectPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  redirect(`/${locale}/story-studio/projects/${projectId}/canvas`);
}
