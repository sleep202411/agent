"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch, useAppSelector } from "@/src/store";
import { selectCurrentInstance } from "@/src/store/slices/projectSlice";
import { confirmProjectParamsFromForm } from "@/src/store/slices/assistantSlice";
import { readMostRecentProjectParam } from "@/src/lib/assistant/assistant-types";
import {
  ProjectParamsForm,
  isProjectParamsComplete,
  type ProjectParamsSuggestion,
} from "./project-params-form";

interface ToolRequireParamsCardProps {
  toolCallId: string;
  /**
   * Fires only in the auto-confirmed case (params were already complete and
   * the form didn't need to render). Parent applies a plain tool result so
   * the supervisor sees `{confirmed: true, autoConfirmed: true}` and keeps
   * going. User submissions go through the `confirmProjectParamsFromForm`
   * thunk directly — no tool-result round-trip needed, because Nest is
   * responsible for the Java save and short-circuit dispatch.
   */
  onAutoConfirmed: () => void;
  /** Supervisor's analyze_brief recommendations. Forwarded to the form. */
  suggested?: ProjectParamsSuggestion;
}

/**
 * Wraps `ProjectParamsForm` as a tool-card. Two paths:
 *   — auto-confirm (params already set): call onAutoConfirmed and render
 *     nothing, so supervisor continues without a redundant form flash.
 *   — user submits the form: dispatch confirmProjectParamsFromForm which
 *     flips the tool part to output-available, appends a visible "信息已確認"
 *     user bubble, and POSTs confirmProjectParams to Nest.
 */
export function ToolRequireParamsCard({
  toolCallId,
  onAutoConfirmed,
  suggested,
}: ToolRequireParamsCardProps) {
  const t = useTranslations("ai");
  const dispatch = useAppDispatch();
  const detail = useAppSelector((s) => selectCurrentInstance(s).detail);
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const targetEpisodeCount = useAppSelector((s) =>
    projectId
      ? readMostRecentProjectParam(
          s.assistant.projects[projectId]?.messages ?? [],
          "targetEpisodeCount"
        )
      : undefined
  );
  const complete = isProjectParamsComplete(detail, targetEpisodeCount);
  const autoConfirmedRef = useRef(false);

  useEffect(() => {
    if (complete && !autoConfirmedRef.current) {
      autoConfirmedRef.current = true;
      onAutoConfirmed();
    }
  }, [complete, onAutoConfirmed]);

  if (complete) {
    return null;
  }

  return (
    <ProjectParamsForm
      suggested={suggested}
      onSubmitted={(params) => {
        if (!projectId) return;
        void dispatch(
          confirmProjectParamsFromForm({
            projectId,
            toolCallId,
            params,
            userLabel: t("paramsConfirmBubble"),
          })
        );
      }}
    />
  );
}
