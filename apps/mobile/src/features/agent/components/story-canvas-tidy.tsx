import { useMemo } from "react";
import { useTranslations } from "@/i18n";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import type { CanvasPositionEdit } from "../../../../canvas-editor/position-schema";
import { canvasTidyHtml } from "../lib/story-canvas-tidy-bridge";
import { canvasTidyRequest } from "../lib/story-canvas-tidy";
import { StoryCanvasEncoder } from "./story-canvas-encoder";
/** Pure geometry worker. The existing position form owns permissions and durable saves. */
export function StoryCanvasTidy({
  loaded,
  selection,
  generation,
  title,
  onResult,
  onError,
}: {
  loaded: CanvasLoaded;
  selection: string[];
  generation: number;
  title: string;
  onResult(edit: CanvasPositionEdit): void;
  onError(message: string): void;
}) {
  const t = useTranslations();
  const tidy = useMemo(
    () => ({
      layout: canvasTidyRequest(loaded.snapshot, selection),
      html: canvasTidyHtml,
      onResult,
    }),
    [loaded, selection, onResult]
  );
  return (
    <StoryCanvasEncoder
      loaded={loaded}
      generation={generation}
      title={title}
      runtimeError={t("storyCanvas.loadError")}
      tidy={tidy}
      onResult={() => {}}
      onError={onError}
    />
  );
}
