"use client";

import { useState } from "react";
import {
  IconCircleCheck,
  IconFile,
  IconGitBranch,
  IconLoader2,
  IconSend,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateCrewTask,
  useCrewSettlements,
  useCrewTaskProject,
  useCrewTaskOptions,
  useSettleCrewItem,
  useSubmitCrewTask,
  type CrewMemberDTO,
  type CrewTaskDTO,
  type CrewTaskFieldDTO,
  type CrewTaskPriority,
} from "@/app/(site)/crews/_hooks/use-crew";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { useTranslations } from "@/src/i18n/i18n";
import { useCrewAssets } from "../../_hooks/use-crew-assets";

export function CreateTaskDialog({
  open,
  onOpenChange,
  crewId,
  members,
  parentTask = null,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
  members: CrewMemberDTO[];
  parentTask?: CrewTaskDTO | null;
  onCreated: (task: CrewTaskDTO) => void;
}) {
  const t = useTranslations("crewTasks");
  const create = useCreateCrewTask(crewId);
  const project = useCrewTaskProject(crewId, open).data;
  const [relationshipQuery, setRelationshipQuery] = useState("");
  const taskOptions = useCrewTaskOptions(
    crewId,
    { query: relationshipQuery.trim() || undefined, limit: 50 },
    open
  );
  const tasks = taskOptions.data;
  const displays = useUserDisplays(members.map((member) => member.userId));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<CrewTaskPriority>("normal");
  const [workflowStateId, setWorkflowStateId] = useState("");
  const [startAt, setStartAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [estimate, setEstimate] = useState("");
  const [budget, setBudget] = useState("");
  const [revisionLimit, setRevisionLimit] = useState("");
  const [cycleId, setCycleId] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [parentId, setParentId] = useState(parentTask?.id ?? "");
  const [blockedByTaskIds, setBlockedByTaskIds] = useState<string[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string | boolean | string[]>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [rewards, setRewards] = useState<Record<string, string>>({});

  const close = (next: boolean) => {
    if (!next) {
      setTitle("");
      setDescription("");
      setPriority("normal");
      setWorkflowStateId("");
      setStartAt("");
      setDueAt("");
      setEstimate("");
      setBudget("");
      setRevisionLimit("");
      setCycleId("");
      setLabelIds([]);
      setParentId(parentTask?.id ?? "");
      setBlockedByTaskIds([]);
      setRelationshipQuery("");
      setCustomValues({});
      setSelected([]);
      setRewards({});
    }
    onOpenChange(next);
  };

  const submit = async () => {
    try {
      const task = await create.mutateAsync({
        title,
        description,
        workflowStateId:
          workflowStateId ||
          project?.workflowStates.find((state) => !state.archived && state.systemKey === "open")
            ?.id,
        priority,
        startAt: startAt ? new Date(`${startAt}T00:00:00`).toISOString() : null,
        dueAt: dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : null,
        estimatePoints: estimate ? Number(estimate) : null,
        computeBudgetPoints: budget ? Number(budget) : null,
        revisionLimit: revisionLimit === "" ? null : Number(revisionLimit),
        cycleId: cycleId || null,
        parentId: parentId || null,
        blockedByTaskIds,
        customFieldValues: (project?.fields ?? []).flatMap<{
          fieldId: string;
          value: string | number | boolean | string[] | null;
        }>((field) => {
          const value = customValues[field.id];
          if (field.type === "checkbox") {
            return [{ fieldId: field.id, value: Boolean(value) }];
          }
          if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
            return field.required ? [{ fieldId: field.id, value: null }] : [];
          }
          return [
            {
              fieldId: field.id,
              value: field.type === "number" ? Number(value) : value,
            },
          ];
        }),
        labelIds,
        assignees: selected.map((userId) => ({
          userId,
          rewardPoints: rewards[userId] ? Math.round(Number(rewards[userId])) : null,
        })),
      });
      toast.success(t("created"));
      onCreated(task);
      close(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("createFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("createTitle")}</DialogTitle>
          <DialogDescription>{t("createDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-[11px] text-muted-foreground">{t("taskTitle")}</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("titlePlaceholder")}
              maxLength={180}
              autoFocus
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] text-muted-foreground">{t("taskBrief")}</span>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("descriptionPlaceholder")}
              maxLength={10_000}
              className="min-h-28"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="space-y-1.5 text-[11px] text-muted-foreground">
              <span>{t("planningState")}</span>
              <select
                value={
                  workflowStateId ||
                  project?.workflowStates.find(
                    (state) => !state.archived && state.systemKey === "open"
                  )?.id ||
                  ""
                }
                onChange={(event) => setWorkflowStateId(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
              >
                {(project?.workflowStates ?? [])
                  .filter(
                    (state) =>
                      !state.archived &&
                      (state.semantic === "open" ||
                        state.semantic === "in_progress" ||
                        state.semantic === "revision_requested")
                  )
                  .map((state) => (
                    <option key={state.id} value={state.id}>
                      {state.systemKey ? t(`status.${state.systemKey}`) : state.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="space-y-1.5 text-[11px] text-muted-foreground">
              <span>{t("priorityLabel")}</span>
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value as CrewTaskPriority)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
              >
                {(["low", "normal", "high", "urgent"] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(`priority.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-[11px] text-muted-foreground">
              <span>{t("cycle")}</span>
              <select
                value={cycleId}
                onChange={(event) => setCycleId(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
              >
                <option value="">{t("backlog")}</option>
                {(project?.cycles ?? [])
                  .filter((cycle) => cycle.status !== "cancelled")
                  .map((cycle) => (
                    <option key={cycle.id} value={cycle.id}>
                      {cycle.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="space-y-1.5 text-[11px] text-muted-foreground">
              <span>{t("estimate")}</span>
              <Input
                type="number"
                min="0"
                value={estimate}
                onChange={(event) => setEstimate(event.target.value)}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="space-y-1.5 text-[11px] text-muted-foreground">
              <span>{t("startAt")}</span>
              <Input
                type="date"
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
              />
            </label>
            <label className="space-y-1.5 text-[11px] text-muted-foreground">
              <span>{t("due")}</span>
              <Input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </label>
            <label className="space-y-1.5 text-[11px] text-muted-foreground">
              <span>{t("budget")}</span>
              <Input
                type="number"
                min="0"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
              />
            </label>
            <label className="space-y-1.5 text-[11px] text-muted-foreground">
              <span>{t("revisionLimit")}</span>
              <Input
                type="number"
                min="0"
                max="100"
                value={revisionLimit}
                onChange={(event) => setRevisionLimit(event.target.value)}
                placeholder={t("revisionUnlimited")}
              />
            </label>
          </div>
          {(project?.labels.length ?? 0) > 0 ? (
            <div>
              <p className="mb-2 text-[11px] text-muted-foreground">{t("labels")}</p>
              <div className="flex flex-wrap gap-2">
                {project!.labels.map((label) => {
                  const checked = labelIds.includes(label.id);
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() =>
                        setLabelIds((current) =>
                          checked ? current.filter((id) => id !== label.id) : [...current, label.id]
                        )
                      }
                      className="rounded-full border px-2.5 py-1 text-[10px]"
                      style={{
                        color: label.color,
                        borderColor: checked ? label.color : `${label.color}55`,
                        backgroundColor: checked ? `${label.color}20` : "transparent",
                      }}
                    >
                      {label.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="rounded-xl border border-border bg-muted/10 p-3">
            <p className="text-[11px] font-medium text-foreground">{t("relationships")}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {t("relationshipsDescription")}
            </p>
            <Input
              value={relationshipQuery}
              onChange={(event) => setRelationshipQuery(event.target.value)}
              placeholder={t("searchRelationships")}
              className="mt-3"
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-[11px] text-muted-foreground">
                <span>{t("parentTask")}</span>
                <select
                  value={parentId}
                  onChange={(event) => setParentId(event.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                >
                  <option value="">{t("noParentTask")}</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      #{task.number} {task.title}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <span className="text-[11px] text-muted-foreground">{t("blockedBy")}</span>
                <div className="mt-1.5 max-h-28 space-y-1 overflow-y-auto rounded-md border border-input bg-background p-1.5">
                  {tasks.length ? (
                    tasks.map((task) => {
                      const checked = blockedByTaskIds.includes(task.id);
                      return (
                        <div
                          key={task.id}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[10px] hover:bg-muted"
                        >
                          <Checkbox
                            checked={checked}
                            aria-label={`${t("blockedBy")}: #${task.number} ${task.title}`}
                            onCheckedChange={(next) =>
                              setBlockedByTaskIds((current) =>
                                next === true
                                  ? [...new Set([...current, task.id])]
                                  : current.filter((id) => id !== task.id)
                              )
                            }
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setBlockedByTaskIds((current) =>
                                checked
                                  ? current.filter((id) => id !== task.id)
                                  : [...current, task.id]
                              )
                            }
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <span className="font-mono text-muted-foreground">#{task.number}</span>
                            <span className="truncate text-foreground">{task.title}</span>
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <span className="block px-2 py-2 text-[10px] text-muted-foreground">
                      {t("noBlockingTasks")}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {taskOptions.hasNextPage ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                color="muted"
                loading={taskOptions.isFetchingNextPage}
                onClick={() => void taskOptions.fetchNextPage()}
                className="mt-2"
              >
                {t("loadMoreRelationships")}
              </Button>
            ) : null}
          </div>
          {(project?.fields.length ?? 0) > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-medium text-foreground">{t("customFields")}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {project!.fields.map((field) => (
                  <TaskCustomFieldInput
                    key={field.id}
                    field={field}
                    members={members}
                    value={customValues[field.id]}
                    onChange={(value) =>
                      setCustomValues((current) => ({ ...current, [field.id]: value }))
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}
          <div>
            <div className="mb-2">
              <p className="text-[11px] text-muted-foreground">{t("chooseAssignees")}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground/65">
                {t("assigneesOptional")}
              </p>
            </div>
            <div className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {members.map((member) => {
                const checked = selected.includes(member.userId);
                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() =>
                        setSelected((current) =>
                          checked
                            ? current.filter((id) => id !== member.userId)
                            : [...current, member.userId]
                        )
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {displayNameOf(member.userId, displays)}
                    </span>
                    {checked ? (
                      <>
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          value={rewards[member.userId] ?? ""}
                          onChange={(event) =>
                            setRewards((current) => ({
                              ...current,
                              [member.userId]: event.target.value,
                            }))
                          }
                          placeholder={t("reward")}
                          className="h-8 w-28 text-right text-[11px]"
                        />
                        <span className="text-[9px] text-muted-foreground">{t("pointsUnit")}</span>
                      </>
                    ) : (
                      <span className="text-[9px] text-muted-foreground">{member.roleType}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => close(false)}>
            {t("cancel")}
          </Button>
          <Button
            disabled={!title.trim() || create.isPending}
            loading={create.isPending}
            onClick={() => void submit()}
          >
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TaskCustomFieldInput({
  field,
  members,
  value,
  onChange,
}: {
  field: CrewTaskFieldDTO;
  members: CrewMemberDTO[];
  value: string | boolean | string[] | undefined;
  onChange: (value: string | boolean | string[]) => void;
}) {
  const t = useTranslations("crewTasks");
  const displays = useUserDisplays(members.map((member) => member.userId));
  const label = (
    <span>
      {field.name}
      {field.required ? <span className="ml-1 text-red-400">*</span> : null}
    </span>
  );
  if (field.type === "checkbox") {
    return (
      <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-[11px] text-foreground">
        <Checkbox
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(Boolean(checked))}
        />
        {label}
      </label>
    );
  }
  if (field.type === "multi_select") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-1.5 text-[11px] text-muted-foreground">
        {label}
        <div className="flex min-h-9 flex-wrap gap-1 rounded-md border border-input bg-background p-1.5">
          {field.options.map((option) => {
            const checked = selected.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() =>
                  onChange(
                    checked
                      ? selected.filter((optionId) => optionId !== option.id)
                      : [...selected, option.id]
                  )
                }
                className={
                  checked
                    ? "rounded bg-red-500/15 px-2 py-1 text-[9px] text-red-200"
                    : "rounded bg-muted px-2 py-1 text-[9px] text-muted-foreground"
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (field.type === "single_select" || field.type === "user") {
    return (
      <label className="space-y-1.5 text-[11px] text-muted-foreground">
        {label}
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
        >
          <option value="">{t("customFieldUnset")}</option>
          {field.type === "single_select"
            ? field.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))
            : members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {displayNameOf(member.userId, displays)}
                </option>
              ))}
        </select>
      </label>
    );
  }
  return (
    <label className="space-y-1.5 text-[11px] text-muted-foreground">
      {label}
      <Input
        type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.description || undefined}
      />
    </label>
  );
}

export function SubmitTaskDialog({
  open,
  onOpenChange,
  crewId,
  task,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
  task: CrewTaskDTO | null;
  onSubmitted: (taskId: string) => void;
}) {
  const t = useTranslations("crewTasks");
  const submitTask = useSubmitCrewTask(crewId);
  const [note, setNote] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const assets =
    useCrewAssets(crewId, { source: "recent", sort: "modified", kind: "file" }, open).data?.items ??
    [];

  const close = (next: boolean) => {
    if (!next) {
      setNote("");
      setAssetIds([]);
    }
    onOpenChange(next);
  };

  const submit = async () => {
    if (!task) return;
    try {
      await submitTask.mutateAsync({ taskId: task.id, note, assetNodeIds: assetIds });
      toast.success(t("submitted"));
      onSubmitted(task.id);
      close(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("submitFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("submitTitle")}</DialogTitle>
          <DialogDescription>{t("submitDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/25 p-3">
            <div className="flex items-center gap-2 text-xs font-medium">
              <IconGitBranch className="size-4 text-primary" />
              {t("canvasIncluded")}
            </div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {t("canvasIncludedHint")}
            </p>
          </div>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("submitNotePlaceholder")}
            maxLength={5000}
            className="min-h-24"
          />
          <div>
            <p className="mb-2 text-[11px] text-muted-foreground">{t("attachAssets")}</p>
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {assets.length === 0 ? (
                <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                  {t("noRecentAssets")}
                </p>
              ) : (
                assets.map((asset) => (
                  <label
                    key={asset.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-xs hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={assetIds.includes(asset.id)}
                      onCheckedChange={() =>
                        setAssetIds((current) =>
                          current.includes(asset.id)
                            ? current.filter((id) => id !== asset.id)
                            : [...current, asset.id]
                        )
                      }
                    />
                    <IconFile className="size-3.5 text-muted-foreground" />
                    <span className="truncate">{asset.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => close(false)}>
            {t("cancel")}
          </Button>
          <Button
            disabled={submitTask.isPending}
            loading={submitTask.isPending}
            onClick={() => void submit()}
            icon={<IconSend />}
          >
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SettlementsDialog({
  open,
  onOpenChange,
  crewId,
  enabled,
  displays,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
  enabled: boolean;
  displays: ReturnType<typeof useUserDisplays>;
}) {
  const t = useTranslations("crewTasks");
  const tc = useTranslations("common");
  const [filter, setFilter] = useState<"all" | "pending" | "settled">("all");
  const query = useCrewSettlements(crewId, enabled && open, filter === "all" ? undefined : filter);
  const settle = useSettleCrewItem(crewId);

  const markSettled = async (itemId: string) => {
    try {
      await settle.mutateAsync({ itemId });
      toast.success(t("settled"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("actionFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("settlements")}</DialogTitle>
          <DialogDescription>{t("settlementsDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="mb-3 flex items-center gap-1 rounded-lg bg-secondary/40 p-1">
            {(["all", "pending", "settled"] as const).map((value) => {
              const count =
                value === "all" ? (query.summary?.total ?? 0) : (query.summary?.[value] ?? 0);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={
                    filter === value
                      ? "flex-1 rounded-md bg-background px-2 py-1.5 text-[11px] font-semibold text-foreground shadow-sm"
                      : "flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  }
                >
                  {t(
                    value === "all"
                      ? "settlementFilterAll"
                      : value === "pending"
                        ? "settlementFilterPending"
                        : "settlementFilterSettled"
                  )}{" "}
                  <span className="font-mono text-[10px]">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="max-h-[55vh] divide-y divide-border overflow-y-auto">
            {query.data.map((item) => (
              <div key={item.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{item.taskTitle}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {displayNameOf(item.userId, displays)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-xs">
                    {formatPoints(item.pointsAmount)} {t("pointsUnit")}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {item.status === "settled" &&
                    item.payoutAmountMinor != null &&
                    item.payoutCurrency
                      ? formatMoney(item.payoutAmountMinor, item.payoutCurrency)
                      : t("usdCashOutEstimate", {
                          amount: formatMoney(item.pointsAmount, "USD"),
                        })}
                  </p>
                </div>
                {item.status === "settled" ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                    <IconCircleCheck className="size-4" />
                    {t("settled")}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    color="muted"
                    disabled={settle.isPending}
                    onClick={() => void markSettled(item.id)}
                  >
                    {t("markSettled")}
                  </Button>
                )}
              </div>
            ))}
            {query.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                <IconLoader2 className="size-4 animate-spin" />
                {tc("loading")}
              </div>
            ) : query.isError ? (
              <p className="py-10 text-center text-xs text-destructive">
                {query.error instanceof Error ? query.error.message : t("actionFailed")}
              </p>
            ) : query.data.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">
                {t("noSettlements")}
              </p>
            ) : null}
            {query.hasNextPage ? (
              <div className="flex justify-center py-3">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  color="muted"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage ? (
                    <IconLoader2 className="size-4 animate-spin" />
                  ) : null}
                  {tc("loadMore")}
                </Button>
              </div>
            ) : null}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amount / 100);
}

function formatPoints(points: number) {
  return new Intl.NumberFormat().format(points);
}
