import { redirect } from "next/navigation";

/** /settings lands on the active workspace's Overview (the reference default). */
export default async function SettingsIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/settings/overview`);
}
