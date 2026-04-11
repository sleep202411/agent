import { useState } from "react";
import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
    const data = input as
      | { summary?: string; headers?: string[]; rows?: Array<string[]> }
      | undefined;
    const headers = data?.headers ?? [];
    const rows = data?.rows ?? [];

    return (
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
        </div>

        {data?.summary && (
          <div className="border-b border-border/30 px-2.5 py-2 text-[12px] text-muted-foreground/70">
            {data.summary}
          </div>
        )}

        {/* Table preview */}
        {rows.length > 0 && headers.length > 0 && (
          <div className="max-h-64 overflow-auto border-t border-border/30">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                  <th className="whitespace-nowrap px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                    #
                  </th>
                  {headers.map((header) => (
                    <th
                      key={header}
                      className="whitespace-nowrap px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {rows.map((row, i) => (
                  <tr key={i} className="hover:bg-white/[0.02]">
                    <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground/40 tabular-nums">
                      {i + 1}
                    </td>
                    {headers.map((_, j) => (
                      <td key={j} className="px-2 py-1.5 text-muted-foreground/70 max-w-48">
                        <span className="line-clamp-2">{row[j] || ""}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {isStreaming && rows.length === 0 && (
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

  return null;
}
