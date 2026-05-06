"use client";

import { useCallback, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  IconLoader2,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconMinus,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { markdownComponents } from "../markdown-components";
import {
  getPersonaFromToolName,
  PERSONA_TONE_CLASSES,
  type AssistantPersonaMeta,
} from "@/src/lib/assistant/personas";
import type { AssistantToolInvocation } from "@/src/lib/assistant/assistant-types";

interface AskPersonaInput {
  task?: string;
}

interface AskPersonaOutput {
  persona?: string;
  /** Markdown prose for the user. */
  summary?: string;
  /** Structured fields for supervisor — not rendered here. */
  fields?: { name: string; description: string; prompt: string } | null;
  tookMs?: number;
  contextBytes?: number;
  error?: string;
}

interface ToolPersonaCardProps {
  toolName: string;
  part: AssistantToolInvocation;
}

/**
 * Renders an ask_* tool invocation as a persona-attributed card:
 * avatar badge + question + reply. Users can tell at a glance which
 * crew role answered, instead of seeing an opaque `tool-ask_xxx` line.
 */
export function ToolPersonaCard({ toolName, part }: ToolPersonaCardProps) {
  const t = useTranslations("ai");
  const persona = getPersonaFromToolName(toolName);

  if (!persona) return null;

  const input = part.input as AskPersonaInput | undefined;
  const output = part.output as AskPersonaOutput | undefined;

  const isConsulting =
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    (part.state !== "output-available" &&
      part.state !== "output-error" &&
      part.state !== "output-denied");

  const hasError = Boolean(output?.error) || part.state === "output-error";
  const summary = output?.summary ?? "";
  const task = input?.task ?? "";

  return (
    <PersonaCard
      persona={persona}
      isConsulting={isConsulting}
      hasError={hasError}
      task={task}
      summary={summary}
      error={output?.error ?? part.errorText}
      tookMs={output?.tookMs}
      t={t}
    />
  );
}

interface PersonaCardInnerProps {
  persona: AssistantPersonaMeta;
  isConsulting: boolean;
  hasError: boolean;
  task: string;
  summary: string;
  error?: string;
  tookMs?: number;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function PersonaCard({
  persona,
  isConsulting,
  hasError,
  task,
  summary,
  error,
  tookMs,
  t,
}: PersonaCardInnerProps) {
  const [expanded, setExpanded] = useState(true);
  const pillClass = PERSONA_TONE_CLASSES[persona.tone];
  const displayName = t(`personas.${persona.nameKey}`);

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-[13px]">
      {/* Persona pill + status row */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] font-medium",
            pillClass
          )}
        >
          <persona.icon className="size-3.5" />
          {displayName}
        </span>

        {isConsulting ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <IconLoader2 className="size-3 animate-spin" />
            {t("personaConsulting")}
          </span>
        ) : hasError ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
            <IconMinus className="size-3 text-muted-foreground/40" />
            {t("personaError")}
          </span>
        ) : (
          <>
            {typeof tookMs === "number" && tookMs > 0 && (
              <span className="text-[11px] text-muted-foreground/60">
                {(tookMs / 1000).toFixed(1)}s
              </span>
            )}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {expanded ? t("personaCollapse") : t("personaExpand")}
              {expanded ? (
                <IconChevronUp className="size-3" />
              ) : (
                <IconChevronDown className="size-3" />
              )}
            </button>
          </>
        )}
      </div>

      {task && (
        <div className="mt-1.5 text-[12px] text-muted-foreground">
          <span className="opacity-70">{t("personaTask")}：</span>
          <span className="italic">{task}</span>
        </div>
      )}

      {hasError && <PersonaErrorRow rawError={typeof error === "string" ? error : ""} />}

      {!hasError && summary && expanded && (
        <div className="mt-2 border-t border-border/40 pt-2 text-[13px] leading-relaxed text-foreground/90">
          <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {summary}
          </Markdown>
        </div>
      )}
    </div>
  );
}

// Friendly inline error indicator with copy-details affordance —
// matches ToolIndicator's failed-tool style. Persona timeouts /
// malformed structured outputs are common (DeepSeek under heavy
// schema pressure); raw "<root> Required" type messages are noise
// to the user but valuable for debugging via copy.
function PersonaErrorRow({ rawError }: { rawError: string }) {
  const t = useTranslations("ai");
  const copy = useCallback(() => {
    if (!rawError) return;
    void navigator.clipboard.writeText(rawError).then(
      () => toast.success(t("toolErrorCopied")),
      () => toast.error(t("toolErrorCopyFailed"))
    );
  }, [rawError, t]);

  return (
    <div className="mt-2 flex items-center gap-2 text-[12px] text-muted-foreground/60">
      <IconMinus className="size-3 text-muted-foreground/40" />
      <span>{t("toolErrorFriendly")}</span>
      {rawError && (
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground/50 transition-colors hover:bg-white/8 hover:text-muted-foreground"
          title={t("toolErrorCopyHint")}
        >
          <IconCopy className="size-3" />
          {t("toolErrorCopy")}
        </button>
      )}
    </div>
  );
}
