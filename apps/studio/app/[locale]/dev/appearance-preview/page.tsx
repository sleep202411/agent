import { notFound } from "next/navigation";
import { AppearancePlayerPreview } from "@/app/[locale]/story-studio/_components/appearance-design/appearance-player-preview";
import { appearancePreviewRuntime } from "./preview-runtime";

/** Local fixture for the real appearance executor. No project writes or publication. */
export default async function AppearancePreviewPage({
  searchParams,
  params,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  params: Promise<{ locale: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const query = await searchParams;
  const { locale } = await params;
  const runtime = await appearancePreviewRuntime();
  const projectId = typeof query.projectId === "string" ? query.projectId : undefined;
  const projectTitle = typeof query.projectTitle === "string" ? query.projectTitle : undefined;
  const chapter = typeof query.chapter === "string" ? query.chapter : undefined;
  const step =
    typeof query.step === "string" &&
    ["canvas", "script", "assets", "storyboard"].includes(query.step)
      ? query.step
      : "canvas";
  const chapterQuery = chapter ? `?${new URLSearchParams({ chapter })}` : "";
  const backHref = projectId
    ? `/story-studio/projects/${encodeURIComponent(projectId)}/${step}${chapterQuery}`
    : "/story-studio";
  return (
    <AppearancePlayerPreview
      key={`${projectId ?? "standalone"}:${runtime.buildId}`}
      projectId={projectId}
      projectTitle={projectTitle}
      backHref={backHref}
      runtime={runtime}
      locale={locale}
      coverUrl="/story-studio/jinling-rumeng-gate-arrival.jpg"
    />
  );
}
