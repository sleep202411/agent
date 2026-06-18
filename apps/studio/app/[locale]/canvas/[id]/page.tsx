import { redirect } from "next/navigation";

/**
 * Legacy immersive canvas route. Projects are now multi-mode workspaces, so this
 * redirects to the project's canvas mode. (Courtesy redirect for old links.)
 */
export default async function LegacyCanvasRedirect(props: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await props.params;
  redirect(`/${locale}/project/${id}/canvas`);
}
