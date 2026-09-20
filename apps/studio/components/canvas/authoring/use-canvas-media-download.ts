"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { downloadCanvasMedia, openCanvasMediaSource, type CanvasMediaKind } from "./download-media";

/** Shared feedback for every Canvas download entry point; never claims a file was saved. */
export function useCanvasMediaDownload() {
  const t = useTranslations("canvasDownload");
  return useCallback(
    async (src: string, name: string, kind: CanvasMediaKind) => {
      const outcome = await downloadCanvasMedia(src, name, kind);
      if (outcome === "failed") {
        toast.error(t("failed"), {
          action: src
            ? {
                label: t("openSource"),
                onClick: () => {
                  if (!openCanvasMediaSource(src)) toast.error(t("blocked"));
                },
              }
            : undefined,
        });
      }
      return outcome;
    },
    [t]
  );
}
