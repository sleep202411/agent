import { redirect } from "next/navigation";

export default async function NarrativeStudioEditorRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/story-studio`);
}
