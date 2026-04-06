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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  children?: React.ReactNode;
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
      {children ? <div className="mt-3">{children}</div> : null}
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

  return {
    title: output.message,
    meta: `${count} · ${output.entityType ?? "item"} · ${output.action}`,
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
  const t = useTranslations("ai");
  const tc = useTranslations("common");
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

    const labels = selectedLabels || t("noSelection");
    const notes = part.output?.notes ? ` · ${part.output.notes}` : "";

    return (
      <CardFrame
        title={input.title}
        description={
          processing
            ? `${t("submittedSelections", { labels })}${notes} · ${t("submittedProcessing")}`
            : `${t("selectedSelections", { labels })}${notes}`
        }
        tone="success"
      >
        <div className="text-xs text-muted-foreground">
          {processing ? t("processingResult") : t("optionsSubmittedHint")}
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
          {tc("confirm")}
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
  const t = useTranslations("ai");
  const tc = useTranslations("common");
  const input = part.input;
  if (!input) return null;

  if (part.state === "output-available") {
    return (
      <CardFrame
        title={input.title}
        description={
          part.output?.confirmed
            ? processing
              ? t("confirmedExecuting")
              : t("confirmedDone")
            : t("cancelled")
        }
        tone={part.output?.confirmed ? "success" : "default"}
      >
        <div className="text-xs text-muted-foreground">
          {processing ? t("processingResult") : t("confirmSubmittedHint")}
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
          {input.cancelLabel || tc("cancel")}
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
          {input.confirmLabel || tc("confirm")}
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
  const t = useTranslations("ai");
  const input = part.input;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [items, setItems] = useState<AssistantRoleProposal[]>(
    part.state === "output-available" && part.output?.items ? part.output.items : input?.items || []
  );

  if (!input) return null;

  if (part.state === "output-available") {
    return (
      <CardFrame
        title={t("roleProposal")}
        description={`${input.summary} · ${part.output?.action === "reject" ? t("rejected") : processing ? t("confirmedCreating") : t("confirmed")}`}
        tone={part.output?.action === "reject" ? "default" : "success"}
      >
        <div className="text-xs text-muted-foreground">
          {part.output?.action === "reject"
            ? t("roleProposalRejected")
            : processing
              ? t("roleCountCreating", { count: part.output?.items?.length ?? input.items.length })
              : t("roleCountDone", { count: part.output?.items?.length ?? input.items.length })}
        </div>
      </CardFrame>
    );
  }

  const roleLabel = (role: string) =>
    role === "main" ? t("roleMain") : role === "supporting" ? t("roleSupporting") : t("roleExtra");

  return (
    <>
      <CardFrame title={t("roleProposal")} description={input.summary}>
        <div className="space-y-1.5">
          {items.map((item, index) => (
            <div
              key={`${part.toolCallId}-${index}`}
              className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2"
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
                {index + 1}
              </span>
              <span className="min-w-0 truncate text-sm font-medium">{item.name}</span>
            </div>
          ))}
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
            {t("viewAndEdit")}
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
                    items,
                  } satisfies AssistantProposalDecision<AssistantRoleProposal>,
                })
              }
            >
              <IconX className="size-3.5" />
              {t("reject")}
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
              {t("acceptAndCreate")}
            </Button>
          </div>
        </div>
      </CardFrame>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[90vw] sm:max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{t("roleProposal")}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {items.map((item, index) => (
              <div
                key={`${part.toolCallId}-dialog-${index}`}
                className="rounded-xl border border-border/70 p-4"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                    {index + 1}
                  </span>
                  <span className="text-sm font-semibold">
                    {item.name || t("characterNamePlaceholder")}
                  </span>
                </div>
                <Input
                  value={item.name}
                  disabled={disabled}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((c, i) => (i === index ? { ...c, name: event.target.value } : c))
                    )
                  }
                  placeholder={t("characterNamePlaceholder")}
                />
                <Textarea
                  value={item.description ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((c, i) =>
                        i === index ? { ...c, description: event.target.value } : c
                      )
                    )
                  }
                  className="mt-3 min-h-20"
                  placeholder={t("characterBioPlaceholder")}
                />
                <Textarea
                  value={item.appearance ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((c, i) =>
                        i === index ? { ...c, appearance: event.target.value } : c
                      )
                    )
                  }
                  className="mt-3 min-h-20"
                  placeholder={t("appearancePlaceholder")}
                />
                <Textarea
                  value={item.personality ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((c, i) =>
                        i === index ? { ...c, personality: event.target.value } : c
                      )
                    )
                  }
                  className="mt-3 min-h-20"
                  placeholder={t("personalityPlaceholder")}
                />
                <Textarea
                  value={item.prompt ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((c, i) =>
                        i === index ? { ...c, prompt: event.target.value } : c
                      )
                    )
                  }
                  className="mt-3 min-h-20"
                  placeholder={t("aiPromptPlaceholder")}
                />
              </div>
            ))}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" color="muted" size="sm" onClick={() => setDialogOpen(false)}>
              {t("backToChat")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
  const t = useTranslations("ai");
  const input = part.input;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [items, setItems] = useState<Array<AssistantSceneProposal | AssistantPropProposal>>(
    part.state === "output-available" && part.output?.items ? part.output.items : input?.items || []
  );

  if (!input) return null;

  if (part.state === "output-available") {
    return (
      <CardFrame
        title={title}
        description={`${input.summary} · ${part.output?.action === "reject" ? t("rejected") : processing ? t("confirmedCreating") : t("confirmed")}`}
        tone={part.output?.action === "reject" ? "default" : "success"}
      >
        <div className="text-xs text-muted-foreground">
          {part.output?.action === "reject"
            ? t("proposalRejected")
            : processing
              ? t("itemCountCreating", { count: part.output?.items?.length ?? input.items.length })
              : t("itemCountDone", { count: part.output?.items?.length ?? input.items.length })}
        </div>
      </CardFrame>
    );
  }

  return (
    <>
      <CardFrame title={title} description={input.summary}>
        <div className="space-y-1.5">
          {items.map((item, index) => (
            <div
              key={`${part.toolCallId}-${index}`}
              className="flex items-start gap-2 rounded-lg border border-border/50 px-3 py-2"
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary mt-0.5">
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{item.name}</div>
                {item.description ? (
                  <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {item.description}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
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
            {t("viewAndEdit")}
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
                    items,
                  } satisfies AssistantProposalDecision<
                    AssistantSceneProposal | AssistantPropProposal
                  >,
                })
              }
            >
              <IconX className="size-3.5" />
              {t("reject")}
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
                  } satisfies AssistantProposalDecision<
                    AssistantSceneProposal | AssistantPropProposal
                  >,
                })
              }
            >
              <IconCheck className="size-3.5" />
              {t("acceptAndCreate")}
            </Button>
          </div>
        </div>
      </CardFrame>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[90vw] sm:max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {items.map((item, index) => (
              <div
                key={`${part.toolCallId}-dialog-${index}`}
                className="rounded-xl border border-border/70 p-4"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                    {index + 1}
                  </span>
                  <span className="text-sm font-semibold">{item.name || t("namePlaceholder")}</span>
                </div>
                <Input
                  value={item.name}
                  disabled={disabled}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((c, i) => (i === index ? { ...c, name: event.target.value } : c))
                    )
                  }
                  placeholder={t("namePlaceholder")}
                />
                <Textarea
                  value={item.description ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((c, i) =>
                        i === index ? { ...c, description: event.target.value } : c
                      )
                    )
                  }
                  className="mt-3 min-h-20"
                  placeholder={t("descriptionPlaceholder")}
                />
                <Textarea
                  value={item.prompt ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((c, i) =>
                        i === index ? { ...c, prompt: event.target.value } : c
                      )
                    )
                  }
                  className="mt-3 min-h-20"
                  placeholder={t("promptWordPlaceholder")}
                />
              </div>
            ))}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" color="muted" size="sm" onClick={() => setDialogOpen(false)}>
              {t("backToChat")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
  const t = useTranslations("ai");
  const input = part.input;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<AssistantStoryboardProposal | null>(
    part.state === "output-available" && part.output?.draft ? part.output.draft : (input ?? null)
  );

  if (!input || !draft) return null;

  if (part.state === "output-available") {
    return (
      <CardFrame
        title={t("storyboardProposal")}
        description={`${draft.summary} · ${part.output?.action === "reject" ? t("rejected") : processing ? t("confirmedCreating") : t("confirmed")}`}
        tone={part.output?.action === "reject" ? "default" : "success"}
      >
        <div className="text-xs text-muted-foreground">
          {part.output?.action === "reject"
            ? t("storyboardRejected")
            : processing
              ? t("storyboardRowsCreating", { count: draft.rows.length })
              : t("storyboardRowsDone", { count: draft.rows.length })}
        </div>
      </CardFrame>
    );
  }

  return (
    <>
      <CardFrame title={t("storyboardProposal")} description={draft.summary}>
        <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
          {t("storyboardDraftHint", { cols: draft.headers.length, rows: draft.rows.length })}
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
            {t("viewAndEdit")}
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
              {t("reject")}
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
              {t("acceptAndWrite")}
            </Button>
          </div>
        </div>
      </CardFrame>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw]">
          <DialogHeader>
            <DialogTitle>{t("storyboardProposal")}</DialogTitle>
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
  const t = useTranslations("ai");
  const tc = useTranslations("common");
  const toolName = getAssistantToolName(part);
  const displayName = part.title || getAssistantToolDisplayName(toolName);

  if (part.state === "input-streaming") {
    return (
      <CardFrame title={displayName} description={t("preparingResult")}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <IconLoader2 className="size-3.5 animate-spin" />
          {t("generatingText")}
        </div>
      </CardFrame>
    );
  }

  if (part.state === "output-error") {
    return (
      <CardFrame title={displayName} description={part.errorText || t("toolFailed")} tone="error">
        <div className="flex items-center gap-2 text-xs text-destructive">
          <IconAlertCircle className="size-3.5" />
          {t("toolRetryHint")}
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
        title={t("sceneProposal")}
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
        title={t("propProposal")}
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

  if (part.state === "output-available") {
    if (isMutationOutput(part.output)) {
      const description = describeMutationOutput(part.output);
      return (
        <CardFrame title={displayName} description={description.title} tone="success">
          <div className="text-xs text-muted-foreground">{description.meta}</div>
        </CardFrame>
      );
    }
    // Read-only tools (get_world_assets, etc.) — show completed
    return <CardFrame title={displayName} description={t("completed")} tone="success" />;
  }

  return (
    <CardFrame title={displayName} description={t("executingStep")}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <IconLoader2 className="size-3.5 animate-spin" />
        {t("executing")}
      </div>
    </CardFrame>
  );
}
