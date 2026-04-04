"use client";

import { useState } from "react";
import {
  IconCheck,
  IconLayoutGrid,
  IconLoader2,
  IconX,
  IconAlertCircle,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  AssistantConfirmActionInput,
  AssistantConfirmActionResult,
  AssistantMutationResult,
  AssistantOptionItem,
  AssistantPropProposal,
  AssistantPropProposalInput,
  AssistantProposalDecision,
  AssistantRoleProposal,
  AssistantRoleProposalInput,
  AssistantSceneProposal,
  AssistantSceneProposalInput,
  AssistantShowOptionsInput,
  AssistantShowOptionsResult,
  AssistantStoryboardDecision,
  AssistantStoryboardProposal,
  AssistantToolResult,
  AssistantToolInvocation,
} from "@/src/lib/assistant/assistant-types";
import {
  getAssistantInteractiveToolName,
  getAssistantToolDisplayName,
  getAssistantToolName,
} from "@/src/lib/assistant/assistant-types";

interface AssistantToolCardProps {
  part: AssistantToolInvocation;
  disabled?: boolean;
  processing?: boolean;
  onApplyResult: (result: AssistantToolResult) => void;
}

function jsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function CardFrame({
  title,
  description,
  children,
  tone = "default",
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  tone?: "default" | "success" | "error";
}) {
  return (
    <div
      className={cn(
        "mt-3 rounded-2xl border p-3",
        tone === "success" && "border-emerald-500/30 bg-emerald-500/10",
        tone === "error" && "border-destructive/30 bg-destructive/10",
        tone === "default" && "border-border/70 bg-background/40"
      )}
    >
      <div className="text-sm font-medium">{title}</div>
      {description ? <div className="mt-1 text-xs text-muted-foreground">{description}</div> : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function isMutationOutput(value: unknown): value is AssistantMutationResult {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return raw.success === true && typeof raw.action === "string" && typeof raw.message === "string";
}

function describeMutationOutput(output: AssistantMutationResult) {
  const count =
    typeof output.count === "number"
      ? output.count
      : Array.isArray(output.entityIds)
        ? output.entityIds.length
        : undefined;

  if (!count || count <= 1) {
    return {
      title: output.message,
      meta: output.action,
    };
  }

  const entityLabel =
    output.entityType === "character"
      ? "角色"
      : output.entityType === "scene"
        ? "场景"
        : output.entityType === "prop"
          ? "道具"
          : "项目项";

  return {
    title: output.message,
    meta: `已批量处理 ${count} 个${entityLabel} · ${output.action}`,
  };
}

function OptionsCard({
  part,
  disabled,
  processing,
  onApplyResult,
}: AssistantToolCardProps & {
  part: AssistantToolInvocation<AssistantShowOptionsInput, AssistantShowOptionsResult>;
}) {
  const input = part.input;
  const [selectedIds, setSelectedIds] = useState<string[]>(
    part.state === "output-available" && part.output?.selectedIds ? part.output.selectedIds : []
  );

  if (!input) return null;

  if (part.state === "output-available") {
    const selectedLabels = input.options
      .filter((option) => part.output?.selectedIds.includes(option.id))
      .map((option) => option.label)
      .join("、");

    return (
      <CardFrame
        title={input.title}
        description={
          processing
            ? `已提交：${selectedLabels || "未选择"}${part.output?.notes ? ` · ${part.output.notes}` : ""} · 助手正在继续处理`
            : `已选择：${selectedLabels || "未选择"}${part.output?.notes ? ` · ${part.output.notes}` : ""}`
        }
        tone="success"
      >
        <div className="text-xs text-muted-foreground">
          {processing ? "处理中…" : "选项结果已提交，助手会继续处理。"}
        </div>
      </CardFrame>
    );
  }

  const toggle = (option: AssistantOptionItem) => {
    if (input.multiple) {
      setSelectedIds((current) =>
        current.includes(option.id)
          ? current.filter((id) => id !== option.id)
          : [...current, option.id]
      );
    } else {
      setSelectedIds([option.id]);
    }
  };

  return (
    <CardFrame title={input.title} description={input.description}>
      <div className="space-y-2">
        {input.options.map((option) => {
          const selected = selectedIds.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(option)}
              className={cn(
                "w-full rounded-xl border px-3 py-2 text-left transition-colors",
                selected
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/70 bg-muted/20 hover:border-primary/20 hover:bg-primary/5"
              )}
            >
              <div className="text-sm font-medium">{option.label}</div>
              {option.description ? (
                <div className="mt-1 text-xs text-muted-foreground">{option.description}</div>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          disabled={disabled || selectedIds.length === 0}
          onClick={() =>
            onApplyResult({
              toolCallId: part.toolCallId,
              toolName: getAssistantInteractiveToolName(part),
              output: {
                selectedIds,
              } satisfies AssistantShowOptionsResult,
            })
          }
        >
          <IconCheck className="size-3.5" />
          确认
        </Button>
      </div>
    </CardFrame>
  );
}

function ConfirmCard({
  part,
  disabled,
  processing,
  onApplyResult,
}: AssistantToolCardProps & {
  part: AssistantToolInvocation<AssistantConfirmActionInput, AssistantConfirmActionResult>;
}) {
  const input = part.input;
  if (!input) return null;

  if (part.state === "output-available") {
    return (
      <CardFrame
        title={input.title}
        description={
          part.output?.confirmed ? (processing ? "已确认，助手正在执行" : "已确认执行") : "已取消"
        }
        tone={part.output?.confirmed ? "success" : "default"}
      >
        <div className="text-xs text-muted-foreground">
          {processing ? "处理中…" : "确认结果已提交，助手会继续处理。"}
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame title={input.title} description={input.description}>
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          color="muted"
          size="sm"
          disabled={disabled}
          onClick={() =>
            onApplyResult({
              toolCallId: part.toolCallId,
              toolName: getAssistantInteractiveToolName(part),
              output: {
                confirmed: false,
              } satisfies AssistantConfirmActionResult,
            })
          }
        >
          <IconX className="size-3.5" />
          {input.cancelLabel || "取消"}
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() =>
            onApplyResult({
              toolCallId: part.toolCallId,
              toolName: getAssistantInteractiveToolName(part),
              output: {
                confirmed: true,
              } satisfies AssistantConfirmActionResult,
            })
          }
        >
          <IconCheck className="size-3.5" />
          {input.confirmLabel || "确认"}
        </Button>
      </div>
    </CardFrame>
  );
}

function RoleProposalCard({
  part,
  disabled,
  processing,
  onApplyResult,
}: AssistantToolCardProps & {
  part: AssistantToolInvocation<
    AssistantRoleProposalInput,
    AssistantProposalDecision<AssistantRoleProposal>
  >;
}) {
  const input = part.input;
  const [items, setItems] = useState<AssistantRoleProposal[]>(
    part.state === "output-available" && part.output?.items ? part.output.items : input?.items || []
  );

  if (!input) return null;

  if (part.state === "output-available") {
    return (
      <CardFrame
        title="角色提案"
        description={`${input.summary} · ${part.output?.action === "reject" ? "已拒绝" : processing ? "已确认，正在创建" : "已确认"}`}
        tone={part.output?.action === "reject" ? "default" : "success"}
      >
        <div className="text-xs text-muted-foreground">
          {part.output?.action === "reject"
            ? "这组角色提案已被拒绝。"
            : processing
              ? `共 ${part.output?.items?.length ?? input.items.length} 个角色，助手正在继续创建。`
              : `共 ${part.output?.items?.length ?? input.items.length} 个角色，助手会继续执行。`}
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame title="角色提案" description={input.summary}>
      <div className="space-y-3">
        {items.map((item, index) => (
          <div
            key={`${part.toolCallId}-${index}`}
            className="rounded-xl border border-border/70 p-3"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={item.name}
                disabled={disabled}
                onChange={(event) =>
                  setItems((current) =>
                    current.map((currentItem, currentIndex) =>
                      currentIndex === index
                        ? { ...currentItem, name: event.target.value }
                        : currentItem
                    )
                  )
                }
                placeholder="角色名称"
              />
              <select
                value={item.role}
                disabled={disabled}
                onChange={(event) =>
                  setItems((current) =>
                    current.map((currentItem, currentIndex) =>
                      currentIndex === index
                        ? {
                            ...currentItem,
                            role: event.target.value as AssistantRoleProposal["role"],
                          }
                        : currentItem
                    )
                  )
                }
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="main">主角</option>
                <option value="supporting">配角</option>
                <option value="extra">群演</option>
              </select>
            </div>

            <Textarea
              value={item.description ?? ""}
              disabled={disabled}
              onChange={(event) =>
                setItems((current) =>
                  current.map((currentItem, currentIndex) =>
                    currentIndex === index
                      ? { ...currentItem, description: event.target.value }
                      : currentItem
                  )
                )
              }
              className="mt-2 min-h-20"
              placeholder="角色简介"
            />

            <Textarea
              value={item.appearance ?? ""}
              disabled={disabled}
              onChange={(event) =>
                setItems((current) =>
                  current.map((currentItem, currentIndex) =>
                    currentIndex === index
                      ? { ...currentItem, appearance: event.target.value }
                      : currentItem
                  )
                )
              }
              className="mt-2 min-h-20"
              placeholder="外貌特征"
            />

            <Textarea
              value={item.personality ?? ""}
              disabled={disabled}
              onChange={(event) =>
                setItems((current) =>
                  current.map((currentItem, currentIndex) =>
                    currentIndex === index
                      ? { ...currentItem, personality: event.target.value }
                      : currentItem
                  )
                )
              }
              className="mt-2 min-h-20"
              placeholder="性格描述"
            />

            <Textarea
              value={item.prompt ?? ""}
              disabled={disabled}
              onChange={(event) =>
                setItems((current) =>
                  current.map((currentItem, currentIndex) =>
                    currentIndex === index
                      ? { ...currentItem, prompt: event.target.value }
                      : currentItem
                  )
                )
              }
              className="mt-2 min-h-20"
              placeholder="AI 提示词"
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          variant="outline"
          color="muted"
          size="sm"
          disabled={disabled}
          onClick={() =>
            onApplyResult({
              toolCallId: part.toolCallId,
              toolName: getAssistantInteractiveToolName(part),
              output: {
                action: "reject",
                items,
              } satisfies AssistantProposalDecision<AssistantRoleProposal>,
            })
          }
        >
          <IconX className="size-3.5" />
          拒绝
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() =>
            onApplyResult({
              toolCallId: part.toolCallId,
              toolName: getAssistantInteractiveToolName(part),
              output: {
                action: jsonEqual(items, input.items) ? "accept" : "accept_edited",
                items,
              } satisfies AssistantProposalDecision<AssistantRoleProposal>,
            })
          }
        >
          <IconCheck className="size-3.5" />
          接受并创建
        </Button>
      </div>
    </CardFrame>
  );
}

function SimpleProposalCard({
  part,
  disabled,
  processing,
  onApplyResult,
  title,
}: AssistantToolCardProps & {
  part: AssistantToolInvocation<
    AssistantSceneProposalInput | AssistantPropProposalInput,
    AssistantProposalDecision<AssistantSceneProposal | AssistantPropProposal>
  >;
  title: string;
}) {
  const input = part.input;
  const [items, setItems] = useState<Array<AssistantSceneProposal | AssistantPropProposal>>(
    part.state === "output-available" && part.output?.items ? part.output.items : input?.items || []
  );

  if (!input) return null;

  if (part.state === "output-available") {
    return (
      <CardFrame
        title={title}
        description={`${input.summary} · ${part.output?.action === "reject" ? "已拒绝" : processing ? "已确认，正在创建" : "已确认"}`}
        tone={part.output?.action === "reject" ? "default" : "success"}
      >
        <div className="text-xs text-muted-foreground">
          {part.output?.action === "reject"
            ? "这组提案已被拒绝。"
            : processing
              ? `共 ${part.output?.items?.length ?? input.items.length} 项，助手正在继续创建。`
              : `共 ${part.output?.items?.length ?? input.items.length} 项，助手会继续执行。`}
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame title={title} description={input.summary}>
      <div className="space-y-3">
        {items.map((item, index) => (
          <div
            key={`${part.toolCallId}-${index}`}
            className="rounded-xl border border-border/70 p-3"
          >
            <Input
              value={item.name}
              disabled={disabled}
              onChange={(event) =>
                setItems((current) =>
                  current.map((currentItem, currentIndex) =>
                    currentIndex === index
                      ? { ...currentItem, name: event.target.value }
                      : currentItem
                  )
                )
              }
              placeholder="名称"
            />
            <Textarea
              value={item.description ?? ""}
              disabled={disabled}
              onChange={(event) =>
                setItems((current) =>
                  current.map((currentItem, currentIndex) =>
                    currentIndex === index
                      ? { ...currentItem, description: event.target.value }
                      : currentItem
                  )
                )
              }
              className="mt-2 min-h-20"
              placeholder="描述"
            />
            <Textarea
              value={item.prompt ?? ""}
              disabled={disabled}
              onChange={(event) =>
                setItems((current) =>
                  current.map((currentItem, currentIndex) =>
                    currentIndex === index
                      ? { ...currentItem, prompt: event.target.value }
                      : currentItem
                  )
                )
              }
              className="mt-2 min-h-20"
              placeholder="提示词"
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          variant="outline"
          color="muted"
          size="sm"
          disabled={disabled}
          onClick={() =>
            onApplyResult({
              toolCallId: part.toolCallId,
              toolName: getAssistantInteractiveToolName(part),
              output: {
                action: "reject",
                items,
              } satisfies AssistantProposalDecision<AssistantSceneProposal | AssistantPropProposal>,
            })
          }
        >
          <IconX className="size-3.5" />
          拒绝
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() =>
            onApplyResult({
              toolCallId: part.toolCallId,
              toolName: getAssistantInteractiveToolName(part),
              output: {
                action: jsonEqual(items, input.items) ? "accept" : "accept_edited",
                items,
              } satisfies AssistantProposalDecision<AssistantSceneProposal | AssistantPropProposal>,
            })
          }
        >
          <IconCheck className="size-3.5" />
          接受并创建
        </Button>
      </div>
    </CardFrame>
  );
}

function StoryboardProposalCard({
  part,
  disabled,
  processing,
  onApplyResult,
}: AssistantToolCardProps & {
  part: AssistantToolInvocation<AssistantStoryboardProposal, AssistantStoryboardDecision>;
}) {
  const input = part.input;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<AssistantStoryboardProposal | null>(
    part.state === "output-available" && part.output?.draft ? part.output.draft : (input ?? null)
  );

  if (!input || !draft) return null;

  if (part.state === "output-available") {
    return (
      <CardFrame
        title="分镜草稿提案"
        description={`${draft.summary} · ${part.output?.action === "reject" ? "已拒绝" : processing ? "已确认，正在写入" : "已确认"}`}
        tone={part.output?.action === "reject" ? "default" : "success"}
      >
        <div className="text-xs text-muted-foreground">
          {part.output?.action === "reject"
            ? "这版分镜草稿已被拒绝。"
            : processing
              ? `共 ${draft.rows.length} 行，助手正在继续写入当前剧集。`
              : `共 ${draft.rows.length} 行，助手会继续保存到当前剧集。`}
        </div>
      </CardFrame>
    );
  }

  return (
    <>
      <CardFrame title="分镜草稿提案" description={draft.summary}>
        <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
          当前草稿包含 {draft.headers.length} 列、{draft.rows.length}{" "}
          行。你可以先查看和轻编辑，再决定是否写入。
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <Button
            variant="outline"
            color="muted"
            size="sm"
            disabled={disabled}
            onClick={() => setDialogOpen(true)}
          >
            <IconLayoutGrid className="size-3.5" />
            查看并编辑
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              color="muted"
              size="sm"
              disabled={disabled}
              onClick={() =>
                onApplyResult({
                  toolCallId: part.toolCallId,
                  toolName: getAssistantInteractiveToolName(part),
                  output: {
                    action: "reject",
                    draft,
                  } satisfies AssistantStoryboardDecision,
                })
              }
            >
              <IconX className="size-3.5" />
              拒绝
            </Button>
            <Button
              size="sm"
              disabled={disabled}
              onClick={() =>
                onApplyResult({
                  toolCallId: part.toolCallId,
                  toolName: getAssistantInteractiveToolName(part),
                  output: {
                    action: jsonEqual(draft, input) ? "accept" : "accept_edited",
                    draft,
                  } satisfies AssistantStoryboardDecision,
                })
              }
            >
              <IconCheck className="size-3.5" />
              接受并写入
            </Button>
          </div>
        </div>
      </CardFrame>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw]">
          <DialogHeader>
            <DialogTitle>分镜草稿提案</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <Textarea
              value={draft.summary}
              disabled={disabled}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, summary: event.target.value } : current
                )
              }
            />

            <div className="max-h-[65vh] overflow-auto rounded-2xl border border-border">
              <table className="min-w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr>
                    {draft.headers.map((header) => (
                      <th
                        key={header}
                        className="border-b border-r border-border px-3 py-2 text-left font-medium"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {draft.rows.map((row, rowIndex) => (
                    <tr key={`${part.toolCallId}-${rowIndex}`} className="align-top">
                      {draft.headers.map((header, columnIndex) => (
                        <td
                          key={`${header}-${rowIndex}`}
                          className="border-r border-t border-border p-2"
                        >
                          <Textarea
                            value={row[columnIndex] ?? ""}
                            disabled={disabled}
                            onChange={(event) =>
                              setDraft((current) => {
                                if (!current) return current;
                                const rows = current.rows.map((item) => [...item]);
                                rows[rowIndex][columnIndex] = event.target.value;
                                return { ...current, rows };
                              })
                            }
                            className="min-h-16 resize-y"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AssistantToolCard({
  part,
  disabled,
  processing = false,
  onApplyResult,
}: AssistantToolCardProps) {
  const toolName = getAssistantToolName(part);
  const displayName = part.title || getAssistantToolDisplayName(toolName);

  if (part.state === "input-streaming") {
    return (
      <CardFrame title={displayName} description="助手正在准备结构化结果。">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <IconLoader2 className="size-3.5 animate-spin" />
          正在生成
        </div>
      </CardFrame>
    );
  }

  if (part.state === "output-error") {
    return (
      <CardFrame title={displayName} description={part.errorText || "工具执行失败"} tone="error">
        <div className="flex items-center gap-2 text-xs text-destructive">
          <IconAlertCircle className="size-3.5" />
          请重试或调整指令。
        </div>
      </CardFrame>
    );
  }

  if (toolName === "show_options") {
    return (
      <OptionsCard
        part={
          part as AssistantToolInvocation<AssistantShowOptionsInput, AssistantShowOptionsResult>
        }
        disabled={disabled}
        processing={processing}
        onApplyResult={onApplyResult}
      />
    );
  }

  if (toolName === "confirm_action") {
    return (
      <ConfirmCard
        part={
          part as AssistantToolInvocation<AssistantConfirmActionInput, AssistantConfirmActionResult>
        }
        disabled={disabled}
        processing={processing}
        onApplyResult={onApplyResult}
      />
    );
  }

  if (toolName === "propose_characters") {
    return (
      <RoleProposalCard
        part={
          part as AssistantToolInvocation<
            AssistantRoleProposalInput,
            AssistantProposalDecision<AssistantRoleProposal>
          >
        }
        disabled={disabled}
        processing={processing}
        onApplyResult={onApplyResult}
      />
    );
  }

  if (toolName === "propose_scenes") {
    return (
      <SimpleProposalCard
        part={
          part as AssistantToolInvocation<
            AssistantSceneProposalInput,
            AssistantProposalDecision<AssistantSceneProposal>
          >
        }
        disabled={disabled}
        processing={processing}
        onApplyResult={onApplyResult}
        title="场景提案"
      />
    );
  }

  if (toolName === "propose_props") {
    return (
      <SimpleProposalCard
        part={
          part as AssistantToolInvocation<
            AssistantPropProposalInput,
            AssistantProposalDecision<AssistantPropProposal>
          >
        }
        disabled={disabled}
        processing={processing}
        onApplyResult={onApplyResult}
        title="道具提案"
      />
    );
  }

  if (toolName === "propose_storyboard_patch") {
    return (
      <StoryboardProposalCard
        part={
          part as AssistantToolInvocation<AssistantStoryboardProposal, AssistantStoryboardDecision>
        }
        disabled={disabled}
        processing={processing}
        onApplyResult={onApplyResult}
      />
    );
  }

  if (part.state === "output-available" && isMutationOutput(part.output)) {
    const description = describeMutationOutput(part.output);

    return (
      <CardFrame title={displayName} description={description.title} tone="success">
        <div className="text-xs text-muted-foreground">{description.meta}</div>
      </CardFrame>
    );
  }

  return (
    <CardFrame title={displayName} description="助手正在执行这一步。">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <IconLoader2 className="size-3.5 animate-spin" />
        执行中
      </div>
    </CardFrame>
  );
}
