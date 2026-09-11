"use client";

import { CREW_CURRENCY } from "@/src/lib/crew-money";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconArrowsDiagonal,
  IconCalendar,
  IconCheck,
  IconChevronRight,
  IconCircle,
  IconCube,
  IconDots,
  IconFlag3,
  IconMovie,
  IconSparkles,
  IconTag,
  IconUserCircle,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  useCreateCrewTask,
  useCrewEpisodes,
  useDraftCrewTask,
  type CrewMemberDTO,
  type CrewTaskDraftDTO,
  type CrewTaskDTO,
  type CrewTaskPriority,
  type CrewTaskProjectDTO,
  type CrewTaskViewDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { TaskSelect } from "./task-select";

interface TaskQuickCreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
  crewName?: string;
  members: CrewMemberDTO[];
  project: CrewTaskProjectDTO;
  activeView: CrewTaskViewDTO;
  presetWorkflowStateId?: string | null;
  parentId?: string | null;
  onCreated?: (task: CrewTaskDTO) => void;
}

export function TaskQuickCreate({
  open,
  onOpenChange,
  crewId,
  crewName,
  members,
  project,
  activeView,
  presetWorkflowStateId,
  parentId,
  onCreated,
}: TaskQuickCreateProps) {
  const t = useTranslations("crewTasks");
  const projectT = useTranslations("crewTaskProject");
  const locale = useLocale() as "en-US" | "zh-CN" | "zh-HK";
  const create = useCreateCrewTask(crewId);
  const episodes = useCrewEpisodes(crewId);
  const draftTask = useDraftCrewTask(crewId);
  const displays = useUserDisplays(members.map((member) => member.userId));
  const titleRef = useRef<HTMLTextAreaElement>(null);
  // Keyboard events can arrive before mutation pending state has rendered.
  const operationInFlight = useRef(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<CrewTaskPriority>("normal");
  const [workflowStateId, setWorkflowStateId] = useState<string | null>(null);
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [createMore, setCreateMore] = useState(false);
  const [draft, setDraft] = useState<CrewTaskDraftDTO | null>(null);
  const [expanded, setExpanded] = useState(false);

  const activeCycle = project.cycles.find((cycle) => cycle.status === "active") ?? null;
  const defaultCycleId = useMemo(() => {
    const filtered = activeView.filters.cycleIds ?? [];
    if (filtered.length === 1) return filtered[0] ?? "";
    return activeCycle?.id ?? "";
  }, [activeCycle?.id, activeView.filters.cycleIds]);
  const defaultWorkflowStateId = useMemo(() => {
    if (
      presetWorkflowStateId &&
      project.workflowStates.some((state) => state.id === presetWorkflowStateId && !state.archived)
    ) {
      return presetWorkflowStateId;
    }
    const filtered = activeView.filters.workflowStateIds ?? [];
    if (filtered.length === 1) {
      const filteredState = project.workflowStates.find(
        (state) => state.id === filtered[0] && !state.archived
      );
      if (filteredState) return filteredState.id;
    }
    return (
      project.workflowStates.find((state) => !state.archived && state.systemKey === "open")?.id ??
      project.workflowStates.find((state) => !state.archived)?.id ??
      ""
    );
  }, [activeView.filters.workflowStateIds, presetWorkflowStateId, project.workflowStates]);
  const resolvedWorkflowStateId = workflowStateId ?? defaultWorkflowStateId;
  const resolvedCycleId = cycleId ?? defaultCycleId;

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => titleRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key.toLowerCase() !== "c") return;
      event.preventDefault();
      onOpenChange(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange]);

  const reset = () => {
    setTitle("");
    setDescription("");
    setPriority("normal");
    setWorkflowStateId(null);
    setAssigneeUserId("");
    setLabelIds([]);
    setCycleId(null);
    setEpisodeId(null);
    setDueDate("");
    setDraft(null);
    draftTask.reset();
  };

  const setOpen = (nextOpen: boolean) => {
    if (!nextOpen && (create.isPending || draftTask.isPending)) return;
    onOpenChange(nextOpen);
    if (!nextOpen) reset();
  };

  const generateDraft = async () => {
    if (operationInFlight.current || create.isPending || draftTask.isPending) return;
    const prompt = [title.trim(), description.trim()].filter(Boolean).join("\n\n");
    if (!prompt) return;
    operationInFlight.current = true;
    try {
      const next = await draftTask.mutateAsync({
        prompt,
        locale,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        memberHints: members.map((member) => ({
          userId: member.userId,
          displayName: displayNameOf(member.userId, displays),
        })),
      });
      setDraft(next);
      setTitle(next.title);
      setDescription(next.description);
      setPriority(next.priority);
      setAssigneeUserId(next.assigneeUserIds[0] ?? "");
      setCycleId(next.cycleId ?? defaultCycleId);
      setDueDate(next.dueDate ?? "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("draftFailed"));
    } finally {
      operationInFlight.current = false;
    }
  };

  const submit = async () => {
    if (operationInFlight.current || create.isPending || draftTask.isPending) return;
    const nextTitle = title.trim();
    if (!nextTitle) {
      titleRef.current?.focus();
      return;
    }
    if (!resolvedWorkflowStateId) return;
    operationInFlight.current = true;
    try {
      const task = await create.mutateAsync({
        title: nextTitle,
        description: description.trim(),
        workflowStateId: resolvedWorkflowStateId,
        priority,
        dueAt: dateEndIso(dueDate || null),
        startAt: dateStartIso(draft?.startDate ?? null),
        estimatePoints: draft?.estimatePoints ?? null,
        computeBudgetPoints: draft?.computeBudgetPoints ?? null,
        revisionLimit: draft?.revisionLimit ?? null,
        cycleId: resolvedCycleId || null,
        episodeId,
        parentId: parentId ?? draft?.parentId ?? null,
        blockedByTaskIds: draft?.blockedByTaskIds ?? [],
        labelIds,
        assignees: assigneeUserId ? [{ userId: assigneeUserId, currency: CREW_CURRENCY }] : [],
      });
      toast.success(t("created"));
      onCreated?.(task);
      if (createMore) {
        reset();
        requestAnimationFrame(() => titleRef.current?.focus());
      } else {
        setOpen(false);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("createFailed"));
    } finally {
      operationInFlight.current = false;
    }
  };

  const activeState = project.workflowStates.find((state) => state.id === resolvedWorkflowStateId);
  const projectLabel = crewName || projectT("title");
  const selectedLabels = project.labels.filter((label) => labelIds.includes(label.id));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/60 supports-backdrop-filter:backdrop-blur-none"
        className={cn(
          "top-[13vh] max-h-[calc(100dvh-2rem)] translate-y-0 gap-0 overflow-visible rounded-[22px] border-[0.5px] border-[#34343a] bg-[#17171a] p-0 text-[#e8e9ec] ring-0 shadow-[0_4px_40px_rgba(0,0,0,.48),0_3px_20px_rgba(0,0,0,.38),0_2px_8px_rgba(0,0,0,.32)] sm:max-w-[750px]",
          expanded && "sm:max-w-[960px]"
        )}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">{t("newIssue")}</DialogTitle>
        <DialogDescription className="sr-only">{t("newIssueDescription")}</DialogDescription>

        <div className="flex h-[48.5px] items-start px-3 pt-3 text-[13px] font-[450] text-[#e5e6e9]">
          <span className="inline-flex h-6 max-w-40 items-center gap-1.5 rounded-full bg-[#252529] py-0 pr-2 pl-[5px] text-[12px] font-medium leading-3 text-[#a4a4ac]">
            <IconCube className="size-3.5 shrink-0 text-[#e52227]" stroke={1.8} />
            <span className="truncate">{projectLabel}</span>
          </span>
          <IconChevronRight className="mx-1 size-3.5 text-[#66666e]" stroke={1.7} />
          <span>{t("newIssue")}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="grid size-7 place-items-center rounded-full text-[#c8c8cf] hover:bg-[#252529] hover:text-white"
              aria-label={expanded ? t("collapseComposer") : t("expandComposer")}
            >
              <IconArrowsDiagonal className="size-4" stroke={1.7} />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid size-7 place-items-center rounded-full text-[#c8c8cf] hover:bg-[#252529] hover:text-white"
              aria-label={t("closeComposer")}
            >
              <IconX className="size-4" stroke={1.7} />
            </button>
          </div>
        </div>

        <div className="px-[18px] pt-[8.5px]">
          <textarea
            ref={titleRef}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setDraft(null);
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            rows={1}
            maxLength={180}
            placeholder={t("titlePlaceholder")}
            aria-label={t("taskTitle")}
            className="block h-6 min-h-6 w-full resize-none overflow-hidden bg-transparent p-0 text-[18px] leading-6 font-semibold tracking-[-0.1px] text-white outline-none placeholder:text-[#686871]"
          />
          <textarea
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              setDraft(null);
            }}
            rows={2}
            maxLength={10_000}
            placeholder={t("descriptionPlaceholder")}
            aria-label={t("taskBrief")}
            className={cn(
              "mt-1.5 block h-[79.2px] w-full resize-none overflow-y-auto bg-transparent px-0 pt-1.5 pb-3 text-[15px] leading-6 font-[450] text-[#d5d5da] outline-none placeholder:text-[#6d6d76]",
              expanded && "h-[140px]"
            )}
          />

          <div className="-mx-1.5 mt-1.5 flex h-6 min-w-0 items-center gap-1.5">
            <SelectChip
              icon={<StateRing color={activeState?.color} />}
              value={resolvedWorkflowStateId}
              label={activeState ? workflowStateLabel(activeState, projectT) : t("planningState")}
              ariaLabel={t("planningState")}
              onChange={setWorkflowStateId}
              options={project.workflowStates
                .filter((state) => !state.archived)
                .map((state) => ({ value: state.id, label: workflowStateLabel(state, projectT) }))}
            />
            <SelectChip
              icon={<IconFlag3 className="size-3.5" />}
              value={priority}
              label={priority === "normal" ? t("priorityLabel") : t(`priority.${priority}`)}
              ariaLabel={t("priorityLabel")}
              onChange={(value) => setPriority(value as CrewTaskPriority)}
              options={(["urgent", "high", "normal", "low"] as const).map((value) => ({
                value,
                label: t(`priority.${value}`),
              }))}
            />
            <SelectChip
              icon={<IconUserCircle className="size-3.5" />}
              value={assigneeUserId}
              label={
                assigneeUserId ? displayNameOf(assigneeUserId, displays) : t("chooseAssignees")
              }
              ariaLabel={t("chooseAssignees")}
              onChange={setAssigneeUserId}
              options={[
                { value: "", label: t("unassigned") },
                ...members.map((member) => ({
                  value: member.userId,
                  label: displayNameOf(member.userId, displays),
                })),
              ]}
            />
            <span className="inline-flex h-6 max-w-[190px] shrink-0 items-center gap-1.5 rounded-full bg-[#252529] py-0 pr-2 pl-1.5 text-[12px] font-medium leading-3 text-[#a4a4ac]">
              <IconCube className="size-3.5 shrink-0 text-[#e52227]" stroke={1.8} />
              <span className="truncate">{projectLabel}</span>
            </span>
            <SelectChip
              icon={<IconMovie className="size-3.5" />}
              value={episodeId ?? ""}
              label={
                episodeId
                  ? (episodes.data?.find((episode) => episode.id === episodeId)?.title ??
                    t("episode"))
                  : t("noEpisode")
              }
              ariaLabel={t("episode")}
              onChange={(value) => setEpisodeId(value || null)}
              options={[
                { value: "", label: t("noEpisode") },
                ...(episodes.data ?? [])
                  .filter((episode) => episode.status !== "cancelled")
                  .map((episode) => ({
                    value: episode.id,
                    label: `${t("episodeNumber", { number: episode.number })} · ${episode.title}`,
                  })),
              ]}
            />
            <LabelChip
              labels={project.labels}
              selectedIds={labelIds}
              onChange={setLabelIds}
              label={
                selectedLabels.length > 0
                  ? selectedLabels.map((item) => item.name).join(", ")
                  : t("labels")
              }
            />
            <MoreOptions
              project={project}
              cycleId={resolvedCycleId}
              dueDate={dueDate}
              draft={draft}
              canGenerate={Boolean(title.trim()) && !create.isPending}
              generating={draftTask.isPending}
              onCycleChange={setCycleId}
              onDueDateChange={setDueDate}
              onGenerate={() => void generateDraft()}
            />
          </div>
        </div>

        <footer className="mt-[11.5px] flex h-[52.5px] items-center px-3">
          <button
            type="button"
            role="switch"
            aria-checked={createMore}
            onClick={() => setCreateMore((value) => !value)}
            className="ml-auto inline-flex items-center gap-2 text-[12px] font-[450] text-[#a4a4ac]"
          >
            <span
              className={cn(
                "relative h-3.5 w-[22px] rounded-full bg-[#6e6e77] transition-colors",
                createMore && "bg-[#5e6ad2]"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 size-2.5 rounded-full bg-white shadow-sm transition-transform",
                  createMore && "translate-x-2"
                )}
              />
            </span>
            {t("createMore")}
          </button>
          <button
            type="button"
            disabled={!resolvedWorkflowStateId || draftTask.isPending || create.isPending}
            onClick={() => void submit()}
            className="ml-4 inline-flex h-7 min-w-[92.625px] items-center justify-center rounded-full bg-[#5e6ad2] px-2.5 text-[12px] font-medium text-white transition-colors hover:bg-[#6874df] disabled:cursor-not-allowed disabled:bg-[#34343a] disabled:text-[#777780]"
          >
            {create.isPending ? t("creating") : t("createTask")}
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function SelectChip({
  icon,
  value,
  label,
  ariaLabel,
  onChange,
  options,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <TaskSelect
      value={value}
      onValueChange={onChange}
      options={options}
      ariaLabel={ariaLabel}
      prefix={<span className="shrink-0">{icon}</span>}
      displayValue={<span className="truncate">{label}</span>}
      className="h-6 w-auto max-w-[190px] shrink-0 rounded-full border-0 bg-[#252529] py-0 pr-1.5 pl-1.5 text-[12px] font-medium leading-3 text-[#a4a4ac] hover:bg-[#2d2d32] hover:text-[#d8d8dd] dark:bg-[#252529] dark:hover:bg-[#2d2d32]"
    />
  );
}

function LabelChip({
  labels,
  selectedIds,
  onChange,
  label,
}: {
  labels: CrewTaskProjectDTO["labels"];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  label: string;
}) {
  const t = useTranslations("crewTasks");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 max-w-[150px] shrink-0 items-center gap-1.5 rounded-full bg-[#252529] py-0 pr-2 pl-1.5 text-[12px] font-medium leading-3 text-[#a4a4ac] hover:bg-[#2d2d32] hover:text-[#d8d8dd]"
          aria-label={t("labels")}
        >
          <IconTag className="size-3.5 shrink-0" stroke={1.8} />
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-60 gap-1 rounded-xl border border-white/[0.09] bg-[#1b1b1f] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,.52)] ring-0"
      >
        {labels.length > 0 ? (
          labels.map((item) => {
            const selected = selectedIds.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  onChange(
                    selected
                      ? selectedIds.filter((id) => id !== item.id)
                      : [...selectedIds, item.id]
                  )
                }
                className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] text-[#c7c7ce] hover:bg-white/[0.06]"
              >
                <span className="size-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {selected ? <IconCheck className="size-3.5 text-[#7f8cff]" /> : null}
              </button>
            );
          })
        ) : (
          <p className="px-2 py-3 text-[11px] text-[#787881]">{t("noLabels")}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function MoreOptions({
  project,
  cycleId,
  dueDate,
  draft,
  canGenerate,
  generating,
  onCycleChange,
  onDueDateChange,
  onGenerate,
}: {
  project: CrewTaskProjectDTO;
  cycleId: string;
  dueDate: string;
  draft: CrewTaskDraftDTO | null;
  canGenerate: boolean;
  generating: boolean;
  onCycleChange: (value: string) => void;
  onDueDateChange: (value: string) => void;
  onGenerate: () => void;
}) {
  const t = useTranslations("crewTasks");
  const [open, setOpen] = useState(false);
  return (
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="grid size-6 place-items-center rounded-full bg-[#252529] text-[#c5c5cc] hover:bg-[#2d2d32] hover:text-white"
        aria-label={t("moreActions")}
        aria-expanded={open}
      >
        <IconDots className="size-3.5" stroke={1.8} />
      </button>
      {open ? (
        <span className="absolute top-8 right-0 z-60 flex w-72 flex-col gap-3 rounded-xl border border-white/[0.09] bg-[#1b1b1f] p-3 shadow-[0_18px_50px_rgba(0,0,0,.52)]">
          <label className="space-y-1.5">
            <span className="flex items-center gap-1.5 text-[10px] font-medium text-[#85858e]">
              <IconAdjustmentsHorizontal className="size-3.5" />
              {t("cycle")}
            </span>
            <TaskSelect
              value={cycleId}
              onValueChange={onCycleChange}
              ariaLabel={t("cycle")}
              className="rounded-lg bg-[#111114] text-[#c9c9cf] focus-visible:border-[#5e6ad2]/70 dark:bg-[#111114]"
              options={[
                { value: "", label: t("backlog") },
                ...project.cycles
                  .filter((cycle) => cycle.status !== "cancelled")
                  .map((cycle) => ({ value: cycle.id, label: cycle.name })),
              ]}
            />
          </label>
          <label className="space-y-1.5">
            <span className="flex items-center gap-1.5 text-[10px] font-medium text-[#85858e]">
              <IconCalendar className="size-3.5" />
              {t("due")}
            </span>
            <input
              type="date"
              value={dueDate}
              onChange={(event) => onDueDateChange(event.target.value)}
              className="h-8 w-full rounded-lg border border-white/[0.09] bg-[#111114] px-2 text-[11px] text-[#c9c9cf] outline-none focus:border-[#5e6ad2]/70"
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            color="muted"
            disabled={!canGenerate}
            loading={generating}
            onClick={onGenerate}
            className="h-8 w-full justify-start rounded-lg px-2 text-[11px]"
            icon={<IconSparkles className="text-[#7f8cff]" />}
          >
            {t("organizeWithAi")}
          </Button>
          {draft?.questions.length ? (
            <p className="rounded-lg bg-amber-300/[0.06] px-2.5 py-2 text-[10px] leading-5 text-amber-100/75">
              {draft.questions.join(" · ")}
            </p>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

function StateRing({ color }: { color?: string }) {
  return (
    <span
      className="grid size-3.5 place-items-center rounded-full border"
      style={{ borderColor: color ?? "#6f7680" }}
    >
      <IconCircle className="size-1 fill-current" style={{ color: color ?? "#6f7680" }} />
    </span>
  );
}

function workflowStateLabel(
  state: CrewTaskProjectDTO["workflowStates"][number],
  t: ReturnType<typeof useTranslations>
) {
  return state.systemKey === "backlog"
    ? t("backlog")
    : state.systemKey
      ? t(`status.${state.systemKey}`)
      : state.name;
}

function dateStartIso(value: string | null): string | null {
  return value ? new Date(`${value}T00:00:00`).toISOString() : null;
}

function dateEndIso(value: string | null): string | null {
  return value ? new Date(`${value}T23:59:59`).toISOString() : null;
}
