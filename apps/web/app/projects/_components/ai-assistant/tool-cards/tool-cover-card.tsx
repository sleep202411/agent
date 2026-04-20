"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch, useAppSelector } from "@/src/store";
import { selectCurrentInstance, setDetail } from "@/src/store/slices/projectSlice";
import type { AssistantToolInvocation } from "@/src/lib/assistant/assistant-types";
import { ToolCompletionCard } from "./tool-completion-card";

interface ToolCoverCardProps {
  part: AssistantToolInvocation;
}

type CoverOutput = {
  skipped?: boolean;
  imagePath?: string;
  previewUrl?: string;
};

/**
 * Renders the state of `generate_project_cover` + applies the side-effect of
 * syncing the newly-set imagePath into projectSlice.detail so the rest of
 * the app (sidebar thumbnail, project card, etc.) reflects the new cover
 * without waiting for a refetch. The agent has already written the path to
 * Java, so this is purely a client cache refresh.
 */
export function ToolCoverCard({ part }: ToolCoverCardProps) {
  const t = useTranslations("ai");
  const dispatch = useAppDispatch();
  const detail = useAppSelector((s) => selectCurrentInstance(s).detail);
  const appliedRef = useRef<string | null>(null);

  const output = (part.output as CoverOutput | undefined) ?? null;
  const imagePath = output?.imagePath;

  useEffect(() => {
    if (!imagePath) return;
    if (appliedRef.current === imagePath) return;
    if (detail?.imagePath === imagePath) {
      appliedRef.current = imagePath;
      return;
    }
    appliedRef.current = imagePath;
    dispatch(setDetail({ ...(detail ?? {}), imagePath }));
  }, [imagePath, detail, dispatch]);

  const state = part.state;
  if (state === "input-available" || state === "input-streaming") {
    return <ToolCompletionCard state="pending" label={t("coverGeneratingChip")} />;
  }
  if (state === "output-available" || state === "approval-responded") {
    if (output?.skipped) {
      return <ToolCompletionCard label={t("coverSkippedChip")} />;
    }
    return <ToolCompletionCard label={t("coverGeneratedChip")} />;
  }
  return null;
}
