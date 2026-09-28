import { getTranslations } from "next-intl/server";
import { ProjectAnalyticsView } from "@/components/analytics/project-analytics-view";
import { PageHeader } from "@/app/[locale]/settings/_components/settings-ui";

interface ProjectAnalyticsPageProps {
  params: Promise<{
    locale: string;
    projectId: string;
  }>;
}

export default async function ProjectAnalyticsPage({ params }: ProjectAnalyticsPageProps) {
  const { projectId } = await params;
  const t = await getTranslations("studioAnalytics");

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <PageHeader title={t("title")} />
      </div>
      <ProjectAnalyticsView projectId={projectId} />
    </main>
  );
}
