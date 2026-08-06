"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { IconLoader2 } from "@tabler/icons-react";
import { useRouter } from "@/i18n/navigation";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";
import { useCanvasConnection } from "@/app/[locale]/project/_components/canvas-connection-context";
import { StoryboardTable } from "./storyboard/storyboard-table";

/**
 * Storyboard mode — the project's canvas document rendered as a shot table.
 *
 * Reads the SAME document as the board via the shell-owned connection + graph
 * (`useCanvasConnection` + the shell's CanvasGraphProvider), so realtime,
 * offline cache, version history and undo all come for free and switching modes
 * converts nothing. Presence carries identity only — `cursor` is canvas-world
 * geometry and means nothing here.
 *
 * `@` in prompt cells opens AssetSelectDialog via PromptTextarea (projectId).
 */
export function StoryboardEditor() {
  const t = useTranslations("storyboard");
  const { projectId } = useProjectContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  // The doc connection + graph are owned by the shell — read, don't re-open.
  const { documentStatus } = useCanvasConnection();

  // A viewer opening a project whose canvas was never created lands here (same
  // as canvas mode does today) — say which document failed, not just "error".
  if (documentStatus === "error") {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-sm text-muted-foreground">{t("openError")}</p>
      </div>
    );
  }

  if (documentStatus === "loading") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <IconLoader2 className="size-6 animate-spin text-white/40" stroke={1.5} />
        <p className="text-xs text-white/40">{t("loading")}</p>
      </div>
    );
  }

  return (
    <StoryboardTable
      focusRowId={searchParams.get("row")}
      onOpenOnCanvas={(nodeId) => router.push(`/project/${projectId}/canvas?focus=${nodeId}`)}
    />
  );
}
