"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { IconLoader2 } from "@tabler/icons-react";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/app/_components/auth-provider";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";
import { CanvasGraphProvider } from "@/lib/canvas-core/canvas-graph-context";
import { toCollabUser } from "@/lib/collab/collab-user";
import { useCanvasDoc } from "@/lib/collab/use-canvas-doc";
import { useCanvasDocument } from "@/lib/collab/use-canvas-document";
import { useCanvasGraph } from "@/lib/collab/use-canvas-graph";
import { useAiCatalog } from "@/lib/canvas-authoring/use-ai-catalog";
import { CanvasGenerationProvider } from "@/lib/canvas-authoring/use-canvas-generation";
import { StoryboardTable } from "./storyboard/storyboard-table";

/**
 * Storyboard mode — the project's canvas document rendered as a shot table.
 *
 * It opens the SAME document as the board (`ensure(projectId, "canvas")`, hard
 * bound to CANVAS_ROOT_SCHEMA), so realtime, offline cache, version history and
 * undo all come for free and switching modes converts nothing. Presence carries
 * identity only — `cursor` is canvas-world geometry and means nothing here.
 */
export function StoryboardEditor() {
  const t = useTranslations("storyboard");
  const { projectId, canEdit } = useProjectContext();
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const collabUser = useMemo(() => toCollabUser(user), [user]);
  const { documentId, status: documentStatus } = useCanvasDocument(projectId);
  const { doc, awareness } = useCanvasDoc(documentId, collabUser);
  const graph = useCanvasGraph(doc, awareness, canEdit);
  const { data: catalog } = useAiCatalog();

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
    <CanvasGraphProvider value={graph}>
      <CanvasGenerationProvider
        catalog={catalog}
        context={{
          projectId,
          documentId: documentId ?? undefined,
          sourceSurface: "fizzstudio-canvas",
        }}
      >
        <StoryboardTable
          focusRowId={searchParams.get("row")}
          onOpenOnCanvas={(nodeId) => router.push(`/project/${projectId}/canvas?focus=${nodeId}`)}
        />
      </CanvasGenerationProvider>
    </CanvasGraphProvider>
  );
}
