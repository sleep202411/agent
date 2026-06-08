"use client";

import { useState } from "react";
import {
  IconCheck,
  IconLoader2,
  IconX,
  IconChevronLeft,
  IconChevronRight,
  IconMaximize,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type {
  AssistantToolInvocation,
  AssistantToolResult,
} from "@/src/lib/assistant/assistant-types";
import { getAssistantToolDisplayName } from "@/src/lib/assistant/assistant-types";

// ─── Types ─────────────────────────────────────────────

interface ScriptInput {
  episodeId?: string;
  episodeTitle?: string;
  summary?: string;
  content?: string;
}

interface BatchScriptItem {
  episodeNumber: number;
  title: string;
  episodeId: string;
  content: string;
}

interface BatchScriptsOutput {
  sessionId?: string;
  batchKey?: string;
  projectId?: string;
  scripts?: BatchScriptItem[];
  summary?: string;
}

interface AssetItem {
  name: string;
  description?: string;
  prompt?: string;
  role?: string;
}

interface AssetInput {
  summary?: string;
  items?: AssetItem[];
}

// ─── Props ─────────────────────────────────────────────

interface ToolProposalCardProps {
  toolName: string;
  part: AssistantToolInvocation;
  onApplyResult: (result: AssistantToolResult) => void;
}

// ─── Component ─────────────────────────────────────────

export function ToolProposalCard({ toolName, part, onApplyResult }: ToolProposalCardProps) {
  const t = useTranslations("ai");
  const displayName = getAssistantToolDisplayName(toolName);
  const [submitted, setSubmitted] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);

  const isStreaming = part.state === "input-streaming";
  const isReady = part.state === "input-available";
  const isDone = part.state === "output-available" || part.state === "approval-responded";
  const isRejected = part.state === "output-denied";
  const input = part.input as Record<string, unknown> | undefined;

  const handleAccept = () => {
    setSubmitted(true);
    onApplyResult({
      toolCallId: part.toolCallId,
      toolName: toolName as AssistantToolResult["toolName"],
      output: { action: "accept" },
    });
  };

  const handleReject = () => {
    setSubmitted(true);
    onApplyResult({
      toolCallId: part.toolCallId,
      toolName: toolName as AssistantToolResult["toolName"],
      output: { action: "reject" },
    });
  };

  const showActions = isReady && !submitted && !isDone && !isRejected;

  // ─── Batch scripts proposal (generate_scripts) ──────

  if (toolName === "generate_scripts") {
    const output = (part.output ?? (part as unknown as Record<string, unknown>).result) as
      | BatchScriptsOutput
      | undefined;
    const scripts = output?.scripts ?? [];
    const current = scripts[currentIdx];

    if (scripts.length === 0 && !isStreaming) {
      return (
        <div className="rounded-xl border border-border/50 overflow-hidden p-4 text-xs text-muted-foreground">
          {t("noScriptsGenerated")}
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-border/50 overflow-hidden">
        {/* Header with pagination */}
        <div className="flex items-center justify-between bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2">
            {isStreaming ? (
              <IconLoader2 className="size-3.5 animate-spin text-primary" />
            ) : isDone || submitted ? (
              <IconCheck className="size-3.5 text-green-500" />
            ) : (
              <IconCheck className="size-3.5 text-primary" />
            )}
            <span className="text-xs font-semibold text-foreground">{t("batchScripts")}</span>
            {current && <span className="text-xs text-muted-foreground">{current.title}</span>}
          </div>
          {scripts.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentIdx === 0}
                onClick={() => setCurrentIdx((i) => i - 1)}
                className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-30"
              >
                <IconChevronLeft className="size-3.5" />
              </button>
              <span className="min-w-[3rem] text-center text-xs tabular-nums text-muted-foreground">
                {currentIdx + 1} / {scripts.length}
              </span>
              <button
                type="button"
                disabled={currentIdx === scripts.length - 1}
                onClick={() => setCurrentIdx((i) => i + 1)}
                className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-30"
              >
                <IconChevronRight className="size-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Script content */}
        {current && (
          <div
            className="max-h-80 overflow-y-auto border-t border-border/30 px-3 py-3 text-[12px] leading-relaxed text-foreground/80"
            dangerouslySetInnerHTML={{ __html: current.content }}
          />
        )}

        {isStreaming && scripts.length === 0 && (
          <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-muted-foreground/50">
            <IconLoader2 className="size-3 animate-spin" />
            {t("generatingBatchScripts")}
          </div>
        )}

        {/* Actions */}
        {showActions && scripts.length > 0 && (
          <div className="flex items-center justify-end gap-2 border-t border-border/30 px-3 py-2">
            <Button variant="ghost" color="muted" size="sm" onClick={handleReject}>
              {t("skip")}
            </Button>
            <Button size="sm" onClick={handleAccept}>
              <IconCheck className="size-3.5" />
              {t("acceptAllScripts", { count: scripts.length })}
            </Button>
          </div>
        )}

        {(isDone || submitted) && (
          <div className="border-t border-border/30 px-3 py-2 text-[11px] text-green-500/70">
            {t("batchScriptsSaved", { count: scripts.length })}
          </div>
        )}
      </div>
    );
  }

  // ─── Script proposal ─────────────────────────────────

  if (toolName === "propose_script") {
    const script = input as ScriptInput | undefined;
    return (
      <div className="rounded-xl border border-border/50 overflow-hidden">
        <div className="flex items-center justify-between bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2">
            {isStreaming ? (
              <IconLoader2 className="size-3.5 animate-spin text-primary" />
            ) : isDone ? (
              <IconCheck className="size-3.5 text-green-500" />
            ) : isRejected ? (
              <IconX className="size-3.5 text-muted-foreground/50" />
            ) : (
              <IconCheck className="size-3.5 text-primary" />
            )}
            <span className="text-[13px] font-medium">{displayName}</span>
            {script?.episodeTitle && (
              <span className="text-[11px] text-muted-foreground/60">{script.episodeTitle}</span>
            )}
          </div>
          {isStreaming && (
            <span className="text-[10px] text-muted-foreground/40 animate-pulse">
              {t("generatingText")}
            </span>
          )}
        </div>

        {script?.summary && (
          <div className="border-b border-border/30 px-2.5 py-2 text-[12px] text-muted-foreground/70">
            {script.summary}
          </div>
        )}

        {script?.content && (
          <div
            className={cn(
              "proposal-content max-h-64 overflow-y-auto px-2.5 py-2 text-[13px] leading-relaxed",
              isStreaming && "animate-pulse"
            )}
            dangerouslySetInnerHTML={{ __html: script.content }}
          />
        )}

        {isStreaming && !script?.content && (
          <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-muted-foreground/50">
            <IconLoader2 className="size-3 animate-spin" />
            {t("generatingText")}
          </div>
        )}

        {showActions && (
          <div className="flex items-center justify-end gap-2 border-t border-border/30 px-3 py-2">
            <Button variant="ghost" color="muted" size="sm" onClick={handleReject}>
              {t("toolSkip")}
            </Button>
            <Button size="sm" onClick={handleAccept}>
              <IconCheck className="size-3" />
              {t("acceptAndWrite")}
            </Button>
          </div>
        )}

        {(submitted || isDone) && !isRejected && (
          <div className="flex items-center gap-2 border-t border-border/30 px-3 py-2 text-[12px] text-muted-foreground/50">
            <IconCheck className="size-3 text-green-500/70" />
            {t("toolResultConfirmed")}
          </div>
        )}

        {isRejected && (
          <div className="border-t border-border/30 px-3 py-2 text-[12px] text-muted-foreground/50">
            {t("scriptRejected")}
          </div>
        )}
      </div>
    );
  }

  // ─── Asset proposals (characters, scenes, props) ─────

  if (
    toolName === "propose_characters" ||
    toolName === "propose_scenes" ||
    toolName === "propose_props"
  ) {
    const data = input as AssetInput | undefined;
    const items = data?.items ?? [];

    return (
      <div className="rounded-xl border border-border/50 overflow-hidden">
        <div className="flex items-center justify-between bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2">
            {isStreaming ? (
              <IconLoader2 className="size-3.5 animate-spin text-primary" />
            ) : isDone ? (
              <IconCheck className="size-3.5 text-green-500" />
            ) : isRejected ? (
              <IconX className="size-3.5 text-muted-foreground/50" />
            ) : (
              <IconCheck className="size-3.5 text-primary" />
            )}
            <span className="text-[13px] font-medium">{displayName}</span>
            {items.length > 0 && (
              <span className="rounded-md bg-white/8 px-1.5 py-0.5 text-[11px] text-muted-foreground/50">
                {items.length}
              </span>
            )}
          </div>
        </div>

        {data?.summary && (
          <div className="border-b border-border/30 px-2.5 py-2 text-[12px] text-muted-foreground/70">
            {data.summary}
          </div>
        )}

        {items.length > 0 && (
          <div className="max-h-64 overflow-y-auto divide-y divide-border/20">
            {items.map((item, i) => (
              <div key={i} className="px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium">{item.name}</span>
                  {item.role && (
                    <span className="rounded bg-white/8 px-1 py-0.5 text-[10px] text-muted-foreground/50">
                      {item.role}
                    </span>
                  )}
                </div>
                {item.description && (
                  <p className="mt-0.5 text-[12px] text-muted-foreground/60 line-clamp-2">
                    {item.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {isStreaming && items.length === 0 && (
          <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-muted-foreground/50">
            <IconLoader2 className="size-3 animate-spin" />
            {t("generatingText")}
          </div>
        )}

        {showActions && (
          <div className="flex items-center justify-end gap-2 border-t border-border/30 px-3 py-2">
            <Button variant="ghost" color="muted" size="sm" onClick={handleReject}>
              {t("toolSkip")}
            </Button>
            <Button size="sm" onClick={handleAccept}>
              <IconCheck className="size-3" />
              {t("toolConfirm")}
            </Button>
          </div>
        )}

        {(submitted || isDone) && !isRejected && (
          <div className="flex items-center gap-2 border-t border-border/30 px-3 py-2 text-[12px] text-muted-foreground/50">
            <IconCheck className="size-3 text-green-500/70" />
            {t("toolResultConfirmed")}
          </div>
        )}

        {isRejected && (
          <div className="border-t border-border/30 px-3 py-2 text-[12px] text-muted-foreground/50">
            {t("toolResultSkipped")}
          </div>
        )}
      </div>
    );
  }

  // ─── Storyboard proposal ─────────────────────────────

  if (toolName === "propose_storyboard_patch") {
    return (
      <StoryboardProposal
        input={input}
        displayName={displayName}
        isStreaming={isStreaming}
        isDone={isDone}
        isRejected={isRejected}
        submitted={submitted}
        showActions={showActions}
        t={t}
        onAccept={handleAccept}
        onReject={handleReject}
      />
    );
  }

  return null;
}

// ─── Storyboard Proposal with expand dialog ──────────

function StoryboardTable({
  headers,
  rows,
  maxH,
}: {
  headers: string[];
  rows: Array<string[]>;
  maxH?: string;
}) {
  return (
    <div className={cn("overflow-auto", maxH)}>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="sticky top-0 bg-muted/80 backdrop-blur-sm">
            <th className="whitespace-nowrap px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              #
            </th>
            {headers.map((h) => (
              <th
                key={h}
                className="whitespace-nowrap px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-white/2">
              <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground/40 tabular-nums">
                {i + 1}
              </td>
              {headers.map((_, j) => (
                <td
                  key={j}
                  className={cn("px-2 py-1.5 text-muted-foreground/70", maxH ? "max-w-48" : "")}
                >
                  <span className={maxH ? "line-clamp-2" : ""}>{row[j] || ""}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StoryboardProposal({
  input,
  displayName,
  isStreaming,
  isDone,
  isRejected,
  submitted,
  showActions,
  t,
  onAccept,
  onReject,
}: {
  input: Record<string, unknown> | undefined;
  displayName: string;
  isStreaming: boolean;
  isDone: boolean;
  isRejected: boolean;
  submitted: boolean;
  showActions: boolean;
  t: (key: string) => string;
  onAccept: () => void;
  onReject: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const data = input as
    | { summary?: string; headers?: string[]; rows?: Array<string[]> }
    | undefined;
  const headers = data?.headers ?? [];
  const rows = data?.rows ?? [];

  return (
    <>
      <div className="rounded-xl border border-border/50 overflow-hidden">
        <div className="flex items-center justify-between bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2">
            {isStreaming ? (
              <IconLoader2 className="size-3.5 animate-spin text-primary" />
            ) : submitted || isDone ? (
              <IconCheck className="size-3.5 text-green-500" />
            ) : isRejected ? (
              <IconX className="size-3.5 text-muted-foreground/50" />
            ) : (
              <IconCheck className="size-3.5 text-primary" />
            )}
            <span className="text-[13px] font-medium">{displayName}</span>
            {rows.length > 0 && (
              <span className="rounded-md bg-white/8 px-1.5 py-0.5 text-[11px] text-muted-foreground/50">
                {rows.length} shots
              </span>
            )}
          </div>
          {rows.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <IconMaximize className="size-3" />
              {t("viewFull")}
            </button>
          )}
        </div>

        {data?.summary && (
          <div className="border-b border-border/30 px-2.5 py-2 text-[12px] text-muted-foreground/70">
            {data.summary}
          </div>
        )}

        {rows.length > 0 && headers.length > 0 && (
          <div className="border-t border-border/30">
            <StoryboardTable headers={headers} rows={rows} maxH="max-h-64" />
          </div>
        )}

        {isStreaming && rows.length === 0 && (
          <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-muted-foreground/50">
            <IconLoader2 className="size-3 animate-spin" /> {t("generatingText")}
          </div>
        )}

        {showActions && (
          <div className="flex items-center justify-end gap-2 border-t border-border/30 px-3 py-2">
            <Button variant="ghost" color="muted" size="sm" onClick={onReject}>
              {t("toolSkip")}
            </Button>
            <Button size="sm" onClick={onAccept}>
              <IconCheck className="size-3" />
              {t("toolConfirm")}
            </Button>
          </div>
        )}

        {(submitted || isDone) && !isRejected && (
          <div className="flex items-center gap-2 border-t border-border/30 px-3 py-2 text-[12px] text-muted-foreground/50">
            <IconCheck className="size-3 text-green-500/70" /> {t("toolResultConfirmed")}
          </div>
        )}

        {isRejected && (
          <div className="border-t border-border/30 px-3 py-2 text-[12px] text-muted-foreground/50">
            {t("toolResultSkipped")}
          </div>
        )}
      </div>

      {/* Full table dialog */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="max-w-5xl max-h-[85vh] p-0 gap-0 overflow-hidden"
          showCloseButton={false}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <DialogTitle className="text-sm font-semibold">{displayName}</DialogTitle>
              <span className="rounded-md bg-white/8 px-1.5 py-0.5 text-[11px] text-muted-foreground/50">
                {rows.length} shots
              </span>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <IconX className="size-4" />
            </button>
          </div>
          <div className="overflow-auto flex-1" style={{ maxHeight: "calc(85vh - 52px)" }}>
            <StoryboardTable headers={headers} rows={rows} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
