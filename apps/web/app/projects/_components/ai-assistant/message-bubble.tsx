"use client";

import { useCallback } from "react";
import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Document, Packer, Paragraph, HeadingLevel, AlignmentType } from "docx";
import fileSaver from "file-saver";

const { saveAs } = fileSaver;
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";

// ─── Export download button ─────────────────────────────

function ExportDownloadButton({ content, filename }: { content: string; filename: string }) {
  const handleDownload = useCallback(async () => {
    // Parse text content into docx paragraphs
    // Content format: "Title\n====\n\ncontent...\n\n---\n\nTitle2\n====\n\ncontent..."
    const sections = content.split(/\n\n---\n\n/);
    const paragraphs: Paragraph[] = [];

    for (const section of sections) {
      const lines = section.split("\n");
      let titleFound = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Title line (followed by === underline)
        if (i + 1 < lines.length && /^=+$/.test(lines[i + 1])) {
          paragraphs.push(
            new Paragraph({ text: line, heading: HeadingLevel.HEADING_1, spacing: { before: 400 } })
          );
          i++; // skip underline
          titleFound = true;
          continue;
        }
        if (line.trim() === "") {
          if (titleFound) paragraphs.push(new Paragraph({ text: "" }));
          continue;
        }
        paragraphs.push(new Paragraph({ text: line }));
        titleFound = true;
      }
    }

    const doc = new Document({
      sections: [{ properties: {}, children: paragraphs }],
    });
    const blob = await Packer.toBlob(doc);
    saveAs(blob, filename);
  }, [content, filename]);

  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => void handleDownload()}
        className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
      >
        <svg
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
        </svg>
        {filename}
      </button>
    </div>
  );
}

// ─── Tool result summary ───────────────────────────────

type TFunc = (key: string, params?: Record<string, string | number | Date>) => string;

// Canonical configure_params keys → i18n key under "ai.configureParamsKey".
// Kept client-side so supervisor can keep seeing the stable English key
// names regardless of user locale.
const CONFIGURE_PARAM_LABEL_KEY: Record<string, string> = {
  targetEpisodeCount: "configureParamsKey.targetEpisodeCount",
  chapterLength: "configureParamsKey.chapterLength",
  shotsPerEpisode: "configureParamsKey.shotsPerEpisode",
  stylePainting: "configureParamsKey.stylePainting",
  dialogLanguage: "configureParamsKey.dialogLanguage",
};

function formatConfigureParamsForDisplay(
  text: string,
  t: TFunc
): Array<{ key: string; label: string; value: string }> {
  const prefix = "Params set: ";
  if (!text.startsWith(prefix)) return [];
  const jsonPart = text.slice(prefix.length).trim();
  let parsed: Record<string, unknown>;
  try {
    const raw = JSON.parse(jsonPart);
    if (!raw || typeof raw !== "object") return [];
    parsed = raw as Record<string, unknown>;
  } catch {
    return [];
  }
  return Object.entries(parsed).map(([key, rawValue]) => {
    const labelKey = CONFIGURE_PARAM_LABEL_KEY[key];
    // Fall back to the raw key name when the param wasn't anticipated —
    // still more readable than hiding it.
    const label = labelKey ? t(labelKey) : key;
    return { key, label, value: String(rawValue ?? "") };
  });
}

function formatToolResultSummary(toolName: string, output: unknown, t: TFunc): string | null {
  const data = output as Record<string, unknown>;
  if (!data) return null;

  switch (toolName) {
    case "show_options": {
      const ids = data.selectedIds as string[] | undefined;
      if (!ids || ids.length === 0) return t("toolResultSkipped");
      return t("toolResultSelected", { value: ids.join("、") });
    }
    case "confirm_action": {
      return data.confirmed ? t("toolResultConfirmed") : t("toolResultCancelled");
    }
    case "configure_params": {
      // Confirmed form submits now dispatch a separate user message with
      // the JSON values (see submitConfigureParams thunk); no summary
      // bubble here to avoid duplicate rendering. Only the dismiss path
      // still surfaces a "skipped" marker.
      if (!data.confirmed) return t("toolResultSkipped");
      return null;
    }
    default:
      return null;
  }
}
import { ToolProposalCard } from "./tool-cards/tool-proposal-card";
import { ToolPersonaCard } from "./tool-cards/tool-persona-card";
import {
  WorkflowCompletedCard,
  WorkflowFailedCard,
  WorkflowProgressCard,
  WorkflowQueuedCard,
  WorkflowSuspendedCard,
} from "./tool-cards/workflow-message-cards";
import { ToolRequireParamsCard } from "./tool-cards/tool-require-params-card";
import { ToolCompletionCard } from "./tool-cards/tool-completion-card";
import { ToolCoverCard } from "./tool-cards/tool-cover-card";
import { ToolExportScriptsCard } from "./tool-cards/tool-export-scripts-card";
import { ProjectParamsForm } from "./tool-cards/project-params-form";
import { AssistantFilePreview } from "./sub-components";
import { markdownComponents } from "./markdown-components";
import {
  getAssistantToolName,
  getAssistantToolDisplayName,
  isAssistantToolPart,
  type AssistantMessage,
  type AssistantToolInvocation,
  type AssistantToolResult,
} from "@/src/lib/assistant/assistant-types";
import { isAskPersonaTool } from "@/src/lib/assistant/personas";
import { extractSuggestedActions } from "@/src/lib/assistant/suggested-action";
import { SuggestedActionButtons } from "./suggested-action-buttons";
import type { WorkflowCompletedOutput, WorkflowFailedOutput } from "@repo/shared";

// ─── Compact tool indicator ───────────────────────────

function ToolIndicator({ toolName, part }: { toolName: string; part: AssistantToolInvocation }) {
  const displayName = getAssistantToolDisplayName(toolName);
  const rawDone = part.state === "output-available";
  // Mastra routes input-validation failures (and other app-level errors)
  // back to the LLM as a **successful** tool result with `output.error=true`
  // so the model can retry. For the UI we want those to read as errors,
  // not green-check successes — otherwise a retry sequence looks like
  // the tool ran N times instead of N-1 failed attempts + 1 success.
  const output = rawDone ? (part.output as Record<string, unknown> | undefined) : undefined;
  const outputErrored = output?.error === true;
  const isError = part.state === "output-error" || part.state === "output-denied" || outputErrored;
  const isLoading = !rawDone && part.state !== "output-error" && part.state !== "output-denied";

  // Extract a short entity label from output (e.g. episode title, character name)
  let entityLabel: string | null = null;
  if (rawDone) {
    const msg = output?.message as string | undefined;
    if (msg && msg.length < 60) entityLabel = msg;
  }

  return (
    <div className="flex items-center gap-2 py-0.5 text-[12px] text-muted-foreground/70">
      {isLoading ? (
        <IconLoader2 className="size-3 animate-spin text-muted-foreground/50" />
      ) : isError ? (
        <IconX className="size-3 text-destructive/70" />
      ) : (
        <IconCheck className="size-3 text-green-500/70" />
      )}
      <span className="font-medium">{displayName}</span>
      {entityLabel && (
        <span className="rounded-md bg-white/8 px-1.5 py-0.5 text-[11px] text-muted-foreground/50">
          {entityLabel}
        </span>
      )}
      {isError && part.errorText && (
        <span className="text-[11px] text-destructive/70">{part.errorText}</span>
      )}
    </div>
  );
}

// ─── Props ─────────────────────────────────────────────

const PROPOSAL_TOOLS = new Set([
  "propose_script",
  "propose_characters",
  "propose_scenes",
  "propose_props",
  "propose_storyboard_patch",
  "generate_scripts",
]);

interface MessageBubbleProps {
  message: AssistantMessage;
  isLastAssistant?: boolean;
  onApplyToolResult?: (result: AssistantToolResult) => void;
}

// ─── Component ─────────────────────────────────────────

export function MessageBubble({ message, isLastAssistant, onApplyToolResult }: MessageBubbleProps) {
  const t = useTranslations("ai");

  // Collect tool result summaries to render as separate "user-like" bubbles
  const toolResultSummaries: Array<{ key: string; summary: string }> = [];
  if (message.role === "assistant") {
    for (const part of message.parts) {
      if (isAssistantToolPart(part)) {
        const tn = getAssistantToolName(part);
        if (
          (tn === "show_options" || tn === "confirm_action" || tn === "configure_params") &&
          part.state === "output-available" &&
          part.output
        ) {
          const summary = formatToolResultSummary(tn, part.output, t);
          if (summary) {
            toolResultSummaries.push({ key: `${message.id}-${part.toolCallId}-result`, summary });
          }
        }
      }
    }
  }

  return (
    <>
      {/* Tool result summaries rendered as user-like messages */}
      {toolResultSummaries.map((item) => (
        <div key={item.key} className="flex justify-end">
          <div className="rounded-xl bg-muted px-3 py-2 text-[13px]">{item.summary}</div>
        </div>
      ))}
      <div
        id={`assistant-message-${message.id}`}
        className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
      >
        <div
          className={cn(
            "max-w-full overflow-hidden text-[13px] leading-relaxed break-words",
            // User message bubbles need internal padding for the pill
            // shape; assistant messages flow into the chat area and rely
            // on the list's space-y-4 for inter-message spacing — extra
            // py-2 here just stacks 16px of whitespace between every
            // chip / card, which looks loose for small compact chips.
            message.role === "user" ? "rounded-xl bg-muted px-3 py-2" : "w-full px-0"
          )}
        >
          {message.metadata?.attachments?.length ? (
            <div className="mb-2 grid gap-2 overflow-hidden">
              {message.metadata.attachments.map((attachment) => (
                <AssistantFilePreview key={attachment.id} attachment={attachment} />
              ))}
            </div>
          ) : null}

          <div className="space-y-3">
            {message.parts.map((part, index) => {
              if (part.type === "text") {
                // Canonical user message `Params set: {JSON}` — parse the
                // JSON and render a localized key:value list. The raw
                // canonical text stays in Redux + is what's sent to the
                // LLM; we only transform the display layer.
                if (message.role === "user" && part.text.startsWith("Params set: ")) {
                  const entries = formatConfigureParamsForDisplay(part.text, t);
                  return (
                    <div
                      key={`${message.id}-text-${index}`}
                      className="text-[13px] leading-relaxed"
                    >
                      <div className="font-medium">{t("configureParamsSubmitted")}</div>
                      {entries.length > 0 && (
                        <div className="mt-1 space-y-0.5 text-[12px] text-foreground/80">
                          {entries.map((line) => (
                            <div key={line.key}>
                              <span className="opacity-70">{line.label}：</span>
                              <span>{line.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                // Strip any trailing ```json {"actions":[...]} ``` block
                // from the rendered markdown; if present, render the
                // action buttons inline. No cross-part coordination —
                // each emission stands alone; supervisor owns dedupe +
                // label uniqueness.
                const { cleanText, suggestedActions } = extractSuggestedActions(part.text);
                return (
                  <div
                    key={`${message.id}-text-${index}`}
                    className="max-w-none text-[13px] leading-relaxed"
                  >
                    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {cleanText}
                    </Markdown>
                    {part.state === "streaming" && (
                      <span className="inline-block h-4 w-0.5 animate-pulse bg-foreground/60" />
                    )}
                    {suggestedActions.length > 0 && (
                      <div className="mt-2">
                        <SuggestedActionButtons
                          actions={suggestedActions}
                          disabled={!isLastAssistant}
                        />
                      </div>
                    )}
                  </div>
                );
              }

              if (part.type === "reasoning") {
                return (
                  <div
                    key={`${message.id}-reasoning-${index}`}
                    className="rounded-xl border border-dashed border-border/70 bg-black/10 px-3 py-2 text-xs text-muted-foreground"
                  >
                    {part.text}
                  </div>
                );
              }

              if (part.type === "file" && message.role === "assistant") {
                return (
                  <AssistantFilePreview
                    key={`${message.id}-file-${index}`}
                    attachment={{
                      id: `${message.id}-file-${index}`,
                      name: part.filename || part.url.split("/").pop() || "attachment",
                      mimeType: part.mediaType,
                      size: 0,
                      url: part.url,
                      status: "uploaded",
                    }}
                  />
                );
              }

              if (part.type === "source-url") {
                return (
                  <a
                    key={`${message.id}-source-url-${index}`}
                    href={part.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-xs text-primary transition-colors hover:bg-primary/5"
                  >
                    {part.title || part.url}
                  </a>
                );
              }

              if (part.type === "source-document") {
                return (
                  <div
                    key={`${message.id}-source-document-${index}`}
                    className="rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-xs text-muted-foreground"
                  >
                    {part.title}
                  </div>
                );
              }

              if (isAssistantToolPart(part)) {
                const toolName = getAssistantToolName(part);

                // Export tool — render download button (generates docx in browser)
                if (toolName === "export_all_scripts" && part.state === "output-available") {
                  const output = (part.output ??
                    (part as unknown as Record<string, unknown>).result) as Record<
                    string,
                    unknown
                  > | null;
                  if (output?.success && output.content) {
                    const filename = String(output.filename ?? "scripts.txt").replace(
                      /\.txt$/,
                      ".docx"
                    );
                    return (
                      <ExportDownloadButton
                        key={`${message.id}-${part.toolCallId}-export`}
                        content={String(output.content)}
                        filename={filename}
                      />
                    );
                  }
                }

                // Interactive tools — composer handles the input UI
                // Only show a compact result summary after user responds
                if (
                  toolName === "show_options" ||
                  toolName === "confirm_action" ||
                  toolName === "configure_params"
                ) {
                  // Result summaries rendered outside the message bubble (above)
                  return null;
                }

                // Project-params preflight — rendered inline in the message
                // stream. Pending: show the interactive form. Done (user
                // actually filled the form): show the same form in readOnly
                // mode so the decision stays anchored where it was made.
                // Auto-confirmed (params were already set, user did nothing):
                // render nothing — no decision was made, don't clutter.
                if (toolName === "require_project_params") {
                  const state = part.state;
                  // Extract tool-call inputs forwarded by the supervisor:
                  //  - suggestedParams: analyze_brief recommendations (prefill)
                  //  - onConfirmWorkflow: which workflow to auto-start after
                  //    the form is confirmed (lets Nest short-circuit, no
                  //    second LLM turn)
                  const input = part.input as
                    | {
                        suggestedParams?: Record<string, unknown>;
                        onConfirmWorkflow?: {
                          workflowName?: string;
                          inputData?: Record<string, unknown>;
                        };
                      }
                    | undefined;
                  const suggested = input?.suggestedParams as
                    | {
                        stylePainting?: string;
                        chapterLength?: number;
                        targetEpisodeCount?: number;
                        dialogLanguage?: string;
                        aspectRatioType?: string;
                        reasoning?: string;
                      }
                    | undefined;
                  const onConfirmWorkflow =
                    input?.onConfirmWorkflow &&
                    typeof input.onConfirmWorkflow.workflowName === "string" &&
                    input.onConfirmWorkflow.workflowName.length > 0
                      ? {
                          workflowName: input.onConfirmWorkflow.workflowName,
                          inputData: input.onConfirmWorkflow.inputData ?? {},
                        }
                      : undefined;
                  if (state === "output-available" || state === "approval-responded") {
                    const out = part.output as { autoConfirmed?: boolean } | undefined;
                    if (out?.autoConfirmed) return null;
                    return (
                      <ProjectParamsForm
                        key={`${message.id}-${part.toolCallId}-params-readonly`}
                        readOnly
                        suggested={suggested}
                      />
                    );
                  }
                  if (
                    (state === "input-available" || state === "approval-requested") &&
                    isLastAssistant
                  ) {
                    return (
                      <ToolRequireParamsCard
                        key={`${message.id}-${part.toolCallId}-params-form`}
                        toolCallId={part.toolCallId}
                        suggested={suggested}
                        onConfirmWorkflow={onConfirmWorkflow}
                        onAutoConfirmed={() => {
                          onApplyToolResult?.({
                            toolCallId: part.toolCallId,
                            toolName: "require_project_params",
                            output: { confirmed: true, autoConfirmed: true },
                          });
                        }}
                      />
                    );
                  }
                  // Stale pending on older messages, errors, or in-flight
                  // input-streaming — render nothing to keep history tidy.
                  // NOTE: if Mastra re-emits the tool call in a restreamed
                  // turn with new state, this branch handles it.
                  return null;
                }

                // New-style workflow lifecycle messages (Phase 2).
                // Each phase transition = a separate assistant message, so
                // these render as independent cards and only the current
                // one mutates (via message_updated) as it progresses.
                if (toolName === "workflow_queued") {
                  return (
                    <WorkflowQueuedCard
                      key={`${message.id}-${part.toolCallId}-wf-queued`}
                      part={part}
                      isActive={!!isLastAssistant}
                    />
                  );
                }
                if (toolName === "workflow_progress") {
                  return (
                    <WorkflowProgressCard
                      key={`${message.id}-${part.toolCallId}-wf-progress`}
                      part={part}
                      isActive={!!isLastAssistant}
                    />
                  );
                }
                if (toolName === "workflow_suspended") {
                  return (
                    <WorkflowSuspendedCard
                      key={`${message.id}-${part.toolCallId}-wf-suspended`}
                      part={part}
                      isActive={!!isLastAssistant}
                    />
                  );
                }
                if (toolName === "workflow_completed") {
                  return (
                    <WorkflowCompletedCard
                      key={`${message.id}-${part.toolCallId}-wf-completed`}
                      part={part}
                      isActive={!!isLastAssistant}
                    />
                  );
                }
                if (toolName === "workflow_failed") {
                  return (
                    <WorkflowFailedCard
                      key={`${message.id}-${part.toolCallId}-wf-failed`}
                      part={part}
                      isActive={!!isLastAssistant}
                    />
                  );
                }

                // apply_phase_drafts — the NL path's analog to the
                // direct-button confirm endpoint. The tool's output carries
                // `completion` / `failure` payloads (same shape as the
                // workflow_completed / workflow_failed side-channel messages
                // the button path emits). We render those inline as parts of
                // supervisor's own message so the card + any follow-up text
                // stay in one bubble instead of fragmenting into a sibling
                // message. Side-channel emission is disabled for this path
                // in the tool impl (see apply-phase-drafts.ts).
                if (toolName === "apply_phase_drafts") {
                  if (part.state !== "output-available" || !part.output) {
                    return (
                      <ToolIndicator
                        key={`${message.id}-${part.toolCallId}-apply-progress`}
                        toolName={toolName}
                        part={part}
                      />
                    );
                  }
                  const out = part.output as {
                    completion?: WorkflowCompletedOutput | null;
                    failure?: WorkflowFailedOutput | null;
                  };
                  if (out.completion) {
                    const synth: AssistantToolInvocation = {
                      type: "tool-workflow_completed",
                      toolCallId: part.toolCallId,
                      state: "output-available",
                      output: out.completion,
                    };
                    return (
                      <WorkflowCompletedCard
                        key={`${message.id}-${part.toolCallId}-apply-completed`}
                        part={synth}
                        isActive={!!isLastAssistant}
                      />
                    );
                  }
                  if (out.failure) {
                    const synth: AssistantToolInvocation = {
                      type: "tool-workflow_failed",
                      toolCallId: part.toolCallId,
                      state: "output-available",
                      output: out.failure,
                    };
                    return (
                      <WorkflowFailedCard
                        key={`${message.id}-${part.toolCallId}-apply-failed`}
                        part={synth}
                        isActive={!!isLastAssistant}
                      />
                    );
                  }
                  return null;
                }

                // invoke_workflow / resume_workflow — the actual workflow
                // cards (WorkflowProgressCard etc. above) own the rich UI.
                // Here we render a compact chip (persona / action label) so
                // the user sees a visible acknowledgement step between the
                // button click and the first workflow_progress card appearing.
                // Matches Claude-Code-style tool indicator chips.
                if (toolName === "invoke_workflow" || toolName === "resume_workflow") {
                  return (
                    <ToolIndicator
                      key={`${message.id}-${part.toolCallId}-${toolName}-${part.state}`}
                      toolName={toolName}
                      part={part}
                    />
                  );
                }

                // UI-only ack tools (no execute, fire-and-forget chip). Nest
                // already did the real work server-side; we just render a
                // green-check confirmation so the user sees what happened.
                if (toolName === "mark_project_params_updated") {
                  const state = part.state;
                  if (state !== "input-available" && state !== "output-available") {
                    return null;
                  }
                  return (
                    <ToolCompletionCard
                      key={`${message.id}-${part.toolCallId}-params-updated`}
                      label={t("paramsUpdatedChip")}
                    />
                  );
                }

                // analyze_brief — small brief-extraction call made before
                // the params form. Render a tiny chip showing the project
                // name / description that was inferred so the user sees
                // what the LLM picked up.
                if (toolName === "analyze_brief") {
                  if (part.state !== "output-available") return null;
                  const out = part.output as
                    | { projectMeta?: { name?: string; description?: string } }
                    | undefined;
                  const name = out?.projectMeta?.name;
                  if (!name) return null;
                  return (
                    <ToolCompletionCard
                      key={`${message.id}-${part.toolCallId}-brief`}
                      label={t("toolBriefAnalyzed", { name })}
                    />
                  );
                }

                // save_project_meta — silent writer. Show a tiny chip only
                // when it actually wrote something (setFields non-empty),
                // so auto-skipped calls don't clutter the timeline.
                if (toolName === "save_project_meta") {
                  if (part.state !== "output-available") return null;
                  const out = part.output as { setFields?: string[] } | undefined;
                  if (!out?.setFields || out.setFields.length === 0) return null;
                  return (
                    <ToolCompletionCard
                      key={`${message.id}-${part.toolCallId}-meta`}
                      label={t("toolMetaUpdated", { fields: out.setFields.join(" / ") })}
                    />
                  );
                }

                // generate_project_cover — execute-bearing tool. Shows a
                // pending spinner chip while the agent is generating +
                // uploading, flips to a green-check chip when done, and
                // syncs the new imagePath into projectSlice.
                if (toolName === "generate_project_cover") {
                  return (
                    <ToolCoverCard
                      key={`${message.id}-${part.toolCallId}-cover-${part.state}`}
                      part={part}
                    />
                  );
                }

                // export_scripts — shows "packed N episodes" chip + a
                // download button that builds the .docx client-side.
                if (toolName === "export_scripts") {
                  return (
                    <ToolExportScriptsCard
                      key={`${message.id}-${part.toolCallId}-export-${part.state}`}
                      part={part}
                    />
                  );
                }

                // ask_* persona tools — render the answer with who replied
                if (isAskPersonaTool(toolName)) {
                  return (
                    <ToolPersonaCard
                      key={`${message.id}-${part.toolCallId}-${toolName}-${part.state}`}
                      toolName={toolName}
                      part={part}
                    />
                  );
                }

                // Proposal tools — render interactive card with content preview
                // For stale messages (not the last assistant msg), treat unfinished proposals as done
                if (PROPOSAL_TOOLS.has(toolName)) {
                  const effectivePart =
                    !isLastAssistant &&
                    (part.state === "input-streaming" || part.state === "input-available")
                      ? { ...part, state: "output-available" as const }
                      : part;
                  return (
                    <ToolProposalCard
                      key={`${message.id}-${part.toolCallId}-${toolName}-${effectivePart.state}`}
                      toolName={toolName}
                      part={effectivePart}
                      onApplyResult={(result) => onApplyToolResult?.(result)}
                    />
                  );
                }

                // All other tools — compact inline indicator
                return (
                  <ToolIndicator
                    key={`${message.id}-${part.toolCallId}-${toolName}-${part.state}`}
                    toolName={toolName}
                    part={part}
                  />
                );
              }

              return null;
            })}
          </div>
        </div>
      </div>
    </>
  );
}
