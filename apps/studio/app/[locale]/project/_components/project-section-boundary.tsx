"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ApiRequestError } from "@/lib/api";
import { CanvasConnectionProvider } from "./canvas-connection-context";
import { useProjectSections } from "./project-sections-context";

export function SectionCanvasBoundary({
  projectId,
  canEdit,
  children,
}: {
  projectId: string;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("project.sections");
  const project = useTranslations("project");
  const common = useTranslations("common");
  const { activeSection, sections, status, error, refresh, selectSection } = useProjectSections();
  const [retrying, setRetrying] = useState(false);
  const unavailable =
    error instanceof ApiRequestError && [401, 403, 404, 410].includes(error.status);
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await refresh();
    } finally {
      setRetrying(false);
    }
  };
  const retryButton = (
    <button
      type="button"
      onClick={() => void retry()}
      disabled={retrying}
      className="rounded-full bg-white/[0.08] px-4 py-2 text-sm text-white/80 transition-colors hover:bg-white/[0.12] disabled:opacity-50"
    >
      {common("retry")}
    </button>
  );
  if (status === "loading") {
    return (
      <div role="status" className="grid min-w-0 flex-1 place-items-center text-sm text-white/45">
        {t("loading")}
      </div>
    );
  }
  if (!activeSection || unavailable) {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center text-sm">
        <p role="alert" className="max-w-md text-white/60">
          {error?.message || t("invalid")}
        </p>
        {retryButton}
        {!unavailable && sections.length > 0 ? (
          <div className="flex max-w-md flex-wrap justify-center gap-2" aria-label={t("title")}>
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => selectSection(section.id)}
                className="max-w-full truncate rounded-full bg-white/[0.06] px-4 py-2 text-white/80 hover:bg-white/[0.1]"
              >
                {section.title}
              </button>
            ))}
          </div>
        ) : null}
        <Link href="/projects" className="text-white/55 hover:text-white">
          {project("backToProjects")}
        </Link>
      </div>
    );
  }
  return (
    <CanvasConnectionProvider
      key={activeSection.canvasDocumentId}
      owner={{ kind: "platform_project", projectId }}
      documentId={activeSection.canvasDocumentId}
      canEdit={canEdit}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {status === "error" ? (
          <div className="flex items-center justify-between gap-4 px-6 py-3 text-sm">
            <p role="alert" className="text-white/60">
              {error?.message || t("loadError")}
            </p>
            {retryButton}
          </div>
        ) : null}
        <div className="relative flex min-h-0 flex-1">{children}</div>
      </div>
    </CanvasConnectionProvider>
  );
}
