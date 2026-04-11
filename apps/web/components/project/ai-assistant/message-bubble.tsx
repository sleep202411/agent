import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";

// ─── Tool result summary ───────────────────────────────

type TFunc = (key: string, params?: Record<string, string | number | Date>) => string;

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
      if (!data.confirmed) return t("toolResultSkipped");
      const values = data.values as Record<string, unknown> | undefined;
      if (!values) return t("toolResultParams");
      const labelMap = (data._labelMap as Record<string, string>) ?? {};
      const entries = Object.entries(values)
        .map(([k, v]) => `${labelMap[k] || k}: ${v}`)
        .join("，");
      return entries;
    }
    default:
      return null;
  }
}
// Old AssistantToolCard removed — replaced by inline ToolIndicator
import { AssistantFilePreview, PipelineThinkingIndicator } from "./sub-components";
import { markdownComponents } from "./markdown-components";
import {
  getAssistantToolName,
  getAssistantToolDisplayName,
  isAssistantToolPart,
  type AssistantMessage,
  type AssistantToolInvocation,
} from "@/src/lib/assistant/assistant-types";

// ─── Pipeline tool config ──────────────────────────────

export const PIPELINE_TOOL_NAMES = new Set([
  "analyze_text",
  "map_episodes",
  "create_episodes_and_assets",
  "generate_scripts",
  "generate_storyboard",
]);

const AGENT_TOOL_LABELS: Record<string, { label: string; steps: string[] }> = {
  analyze_text: {
    label: "Analyzing script",
    steps: [
      "Extracting characters and aliases",
      "Identifying scenes and locations",
      "Generating chapter outline",
      "Detecting language and style",
    ],
  },
  map_episodes: {
    label: "Mapping episodes",
    steps: [
      "Analyzing narrative arcs",
      "Distributing chapters to episodes",
      "Balancing episode lengths",
    ],
  },
  create_episodes_and_assets: { label: "Creating episodes & assets", steps: [] },
  generate_scripts: {
    label: "Generating scripts",
    steps: [
      "Writing shootable format",
      "Adding dialogue and actions",
      "Inserting visual descriptions",
      "Saving to episodes",
    ],
  },
  generate_storyboard: {
    label: "Generating storyboard",
    steps: [
      "Composing shot descriptions",
      "Setting camera angles",
      "Writing video prompts",
      "Saving to episodes",
    ],
  },
};

// ─── Compact tool indicator ───────────────────────────

const PROPOSAL_TOOLS = new Set([
  "propose_script",
  "propose_characters",
  "propose_scenes",
  "propose_props",
  "propose_storyboard_patch",
]);

function ToolIndicator({ toolName, part }: { toolName: string; part: AssistantToolInvocation }) {
  const displayName = getAssistantToolDisplayName(toolName);
  const isProposal = PROPOSAL_TOOLS.has(toolName);
  const isDone =
    part.state === "output-available" ||
    part.state === "approval-requested" ||
    part.state === "approval-responded" ||
    // Proposal tools with input-available are waiting for user — treat as done
    (isProposal && part.state === "input-available");
  const isError = part.state === "output-error" || part.state === "output-denied";
  const isLoading = !isDone && !isError;

  // Extract a short entity label from output (e.g. episode title, character name)
  let entityLabel: string | null = null;
  if (isDone || isError) {
    const output = part.output as Record<string, unknown> | undefined;
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

interface MessageBubbleProps {
  message: AssistantMessage;
}

// ─── Component ─────────────────────────────────────────

export function MessageBubble({ message }: MessageBubbleProps) {
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
            "max-w-full overflow-hidden px-2 py-2 text-[13px] leading-relaxed break-words",
            message.role === "user" ? "rounded-xl bg-muted" : ""
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
                return (
                  <div
                    key={`${message.id}-text-${index}`}
                    className="max-w-none text-[13px] leading-relaxed"
                  >
                    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {part.text}
                    </Markdown>
                    {part.state === "streaming" && (
                      <span className="inline-block h-4 w-0.5 animate-pulse bg-foreground/60" />
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
                const pipelineInfo = AGENT_TOOL_LABELS[toolName];

                if (pipelineInfo) {
                  const rawOutput =
                    part.output ?? (part as unknown as Record<string, unknown>).result;
                  const output =
                    (part.state === "output-available" || part.state === "output-error") &&
                    rawOutput
                      ? (rawOutput as Record<string, unknown>)
                      : null;
                  const taskId = output?.taskId ? String(output.taskId) : null;

                  // Task card is rendered in the composer, not here
                  if (taskId) {
                    return null;
                  }

                  if (part.state !== "output-available" && part.state !== "output-error") {
                    return (
                      <PipelineThinkingIndicator
                        key={`${message.id}-${part.toolCallId}-thinking`}
                        label={pipelineInfo.label}
                        steps={pipelineInfo.steps}
                      />
                    );
                  }

                  return null;
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
