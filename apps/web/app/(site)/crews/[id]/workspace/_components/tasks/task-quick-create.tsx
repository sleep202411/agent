"use client";
import { v4 as submissionUuid } from "uuid";
import {
  isTaskRequestReceipt,
  type TaskRequestReceipt,
} from "@/app/(site)/crews/_hooks/task-request-receipt";
import { taskLocalDate } from "./task-local-date";
import { Input } from "@/components/ui/input";
import { TaskPaymentHelp } from "../../../../_components/task-payment-help";
import {
  CURRENT_TASK_PAYMENT_TERMS,
  TASK_PAYMENT_TERMS,
  type TaskPaymentTerms,
} from "@repo/shared/crew";
import { useCurrentUser } from "@/src/hooks/use-user";
import { missingTaskFields } from "./task-required-fields";
import { TaskDeliveryUpload } from "./task-delivery-upload";
import { TaskContractLink } from "@/app/(site)/crews/_components/task-contract-link";
import { useTranslatedPresetPositions } from "@/app/(site)/crews/_hooks/use-position-label";
import { RequiredSkillsSelect } from "@/app/(site)/crews/_components/required-skills-select";

import { workflowStateLabel } from "@/app/(site)/crews/_lib/workflow-state-label";

import { Calendar } from "@/components/ui/calendar";
import { enUS, zhCN, zhHK } from "date-fns/locale";
import { CREW_CURRENCY } from "@/src/lib/crew-money";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowsDiagonal,
  IconCalendar,
  IconCoin,
  IconChevronRight,
  IconCircle,
  IconCube,
  IconCategory,
  IconFlag3,
  IconSparkles,
  IconUserCircle,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CREW_TASK_KIND_MESSAGE_KEYS,
  CREW_TASK_KINDS,
  useCreateCrewTask,
  useCrewEpisodes,
  useCrewTaskKindTemplates,
  useDraftCrewTask,
  type CreateCrewTaskInput,
  type CrewMemberDTO,
  type CrewTaskDraftDTO,
  type CrewTaskDTO,
  type CrewTaskKind,
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
  presetEpisodeId?: string | null;
  presetTaskKind?: CrewTaskKind | null;
  parentId?: string | null;
  onCreated?: (task: CrewTaskDTO) => void;
  onPublishTask?: (taskId: string) => void;
  onInviteTask?: (task: CrewTaskDTO) => void;
  onStage?: (input: CreateCrewTaskInput) => void;
  onCreateStaged?: (input: CreateCrewTaskInput) => Promise<CrewTaskDTO | TaskRequestReceipt>;
  keyboardShortcut?: boolean;
  initialInput?: CreateCrewTaskInput;
  onSave?: (input: CreateCrewTaskInput) => Promise<CrewTaskDTO>;
  saving?: boolean;
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
  presetEpisodeId,
  presetTaskKind,
  parentId,
  onCreated,
  onPublishTask,
  onInviteTask,
  onStage,
  onCreateStaged,
  keyboardShortcut = true,
  initialInput,
  onSave,
  saving = false,
}: TaskQuickCreateProps) {
  const t = useTranslations("crewTasks");
  const projectT = useTranslations("crewTaskProject");
  const positions = useTranslatedPresetPositions();
  const { user } = useCurrentUser();
  const actorId = user?.id ?? null;
  const [contractAssetNodeId, setContractAssetNodeId] = useState(
    initialInput?.contractAssetNodeId ?? null
  );
  const [contractFilename, setContractFilename] = useState("");
  const [contractUploading, setContractUploading] = useState(false);
  const contractBusy = useRef(false);
  const [contractUploadRevision, setContractUploadRevision] = useState(0);
  const [positionRole, setPositionRole] = useState(initialInput?.positionRole ?? "");
  const locale = useLocale() as "en-US" | "zh-CN" | "zh-HK";
  const create = useCreateCrewTask(crewId);
  const submission = useRef<{ fingerprint: string; key: string } | null>(null);
  const episodes = useCrewEpisodes(crewId);
  const templates = useCrewTaskKindTemplates(crewId, open);
  const draftTask = useDraftCrewTask(crewId);
  const { reset: resetCreate } = create;
  const { reset: resetDraft } = draftTask;
  const displays = useUserDisplays(members.map((member) => member.userId));
  const titleRef = useRef<HTMLTextAreaElement>(null);
  // Keyboard events can arrive before mutation pending state has rendered.
  const operationInFlight = useRef(false);
  const draftRevision = useRef(0);
  const [title, setTitle] = useState(initialInput?.title ?? "");
  const [description, setDescription] = useState(initialInput?.description ?? "");
  const [priority, setPriority] = useState<CrewTaskPriority>(initialInput?.priority ?? "normal");
  const [assetCategory, setAssetCategory] = useState<"characters" | "scenes" | "props" | "art">(
    initialInput?.assetCategory ?? "art"
  );
  const [taskKind, setTaskKind] = useState<CrewTaskKind | "">(
    initialInput?.taskKind ?? presetTaskKind ?? ""
  );
  const [workflowStateId, setWorkflowStateId] = useState<string | null>(
    initialInput?.workflowStateId ?? null
  );
  const [assigneeUserId, setAssigneeUserId] = useState(initialInput?.assignees[0]?.userId ?? "");
  const [requiredSkills, setRequiredSkills] = useState<string[]>(
    initialInput?.requiredSkills ?? []
  );
  const [labelIds, setLabelIds] = useState<string[]>(initialInput?.labelIds ?? []);
  const [cycleId, setCycleId] = useState<string | null>(
    initialInput ? (initialInput.cycleId ?? "") : null
  );
  const [episodeId, setEpisodeId] = useState<string | null>(
    initialInput?.episodeId ?? presetEpisodeId ?? null
  );
  const [computePoints, setComputePoints] = useState(
    initialInput?.computeBudgetPoints?.toString() ?? ""
  );
  const [estimatePoints, setEstimatePoints] = useState(
    initialInput?.estimatePoints?.toString() ?? ""
  );
  const [rewardUsd, setRewardUsd] = useState(
    initialInput?.rewardUsdMinor == null ? "" : String(initialInput.rewardUsdMinor / 100)
  );
  const [paymentTerms, setPaymentTerms] = useState<TaskPaymentTerms>(
    initialInput?.paymentTerms ?? "on_completion"
  );
  const paymentT = useTranslations("taskPaymentTerms");
  const [profitShare, setProfitShare] = useState(
    initialInput?.profitShareBps == null ? "" : String(initialInput.profitShareBps / 100)
  );
  const [dueDate, setDueDate] = useState(taskLocalDate(initialInput?.dueAt));
  const [createMore, setCreateMore] = useState(false);
  const [draft, setDraft] = useState<CrewTaskDraftDTO | null>(null);
  const [expanded, setExpanded] = useState(false);

  const [context, setContext] = useState({ open, crewId, parentId, actorId });
  if (
    context.open !== open ||
    context.crewId !== crewId ||
    context.parentId !== parentId ||
    context.actorId !== actorId
  ) {
    setContext({ open, crewId, parentId, actorId });
    setTitle(initialInput?.title ?? "");
    setDescription(initialInput?.description ?? "");
    setPriority(initialInput?.priority ?? "normal");
    setAssetCategory(initialInput?.assetCategory ?? "art");
    setTaskKind(initialInput?.taskKind ?? presetTaskKind ?? "");
    setWorkflowStateId(initialInput?.workflowStateId ?? null);
    setAssigneeUserId(initialInput?.assignees[0]?.userId ?? "");
    setRequiredSkills(initialInput?.requiredSkills ?? []);
    setPositionRole(initialInput?.positionRole ?? "");
    setContractAssetNodeId(initialInput?.contractAssetNodeId ?? null);
    setContractFilename("");
    setContractUploading(false);
    setContractUploadRevision((revision) => revision + 1);
    setLabelIds(initialInput?.labelIds ?? []);
    setCycleId(initialInput ? (initialInput.cycleId ?? "") : null);
    setEpisodeId(initialInput?.episodeId ?? presetEpisodeId ?? null);
    setComputePoints(initialInput?.computeBudgetPoints?.toString() ?? "");
    setEstimatePoints(initialInput?.estimatePoints?.toString() ?? "");
    setRewardUsd(
      initialInput?.rewardUsdMinor == null ? "" : String(initialInput.rewardUsdMinor / 100)
    );
    setPaymentTerms(initialInput?.paymentTerms ?? "on_completion");
    setProfitShare(
      initialInput?.profitShareBps == null ? "" : String(initialInput.profitShareBps / 100)
    );
    setDueDate(taskLocalDate(initialInput?.dueAt));
    setDraft(null);
  }
  const session = useRef(0);
  useEffect(() => {
    session.current += 1;
    operationInFlight.current = false;
    contractBusy.current = false;
    resetCreate();
    resetDraft();
    return () => {
      session.current += 1;
    };
  }, [open, crewId, parentId, actorId, resetCreate, resetDraft]);

  const activeCycle = project.cycles.find((cycle) => cycle.status === "active") ?? null;
  const defaultCycleId = useMemo(() => {
    const filtered = activeView.filters.cycleIds ?? [];
    if (filtered.length === 1) {
      const filteredCycle = project.cycles.find(
        (cycle) => cycle.id === filtered[0] && cycle.status !== "cancelled"
      );
      if (filteredCycle) return filteredCycle.id;
    }
    return activeCycle?.id ?? "";
  }, [activeCycle?.id, activeView.filters.cycleIds, project.cycles]);
  const creationStates = useMemo(
    () =>
      project.workflowStates.filter(
        (state) =>
          (onSave && state.id === initialInput?.workflowStateId) ||
          (!state.archived &&
            ["open", "in_progress", "revision_requested"].includes(state.semantic))
      ),
    [project.workflowStates, onSave, initialInput?.workflowStateId]
  );
  const defaultWorkflowStateId = useMemo(() => {
    if (
      presetWorkflowStateId &&
      creationStates.some((state) => state.id === presetWorkflowStateId && !state.archived)
    ) {
      return presetWorkflowStateId;
    }
    const filtered = activeView.filters.workflowStateIds ?? [];
    if (filtered.length === 1) {
      const filteredState = creationStates.find(
        (state) => state.id === filtered[0] && !state.archived
      );
      if (filteredState) return filteredState.id;
    }
    return (
      creationStates.find((state) => !state.archived && state.systemKey === "open")?.id ??
      creationStates.find((state) => !state.archived)?.id ??
      ""
    );
  }, [activeView.filters.workflowStateIds, presetWorkflowStateId, creationStates]);
  const resolvedWorkflowStateId =
    (onSave && workflowStateId === initialInput?.workflowStateId) ||
    creationStates.some((state) => state.id === workflowStateId)
      ? workflowStateId!
      : defaultWorkflowStateId;
  const resolvedCycleId = cycleId ?? defaultCycleId;

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => titleRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!keyboardShortcut) return;
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
  }, [onOpenChange, keyboardShortcut]);

  const reset = () => {
    draftRevision.current += 1;
    setTitle("");
    setDescription("");
    setRequiredSkills([]);
    setPositionRole("");
    setContractAssetNodeId(null);
    setContractFilename("");
    contractBusy.current = false;
    setContractUploading(false);
    setContractUploadRevision((revision) => revision + 1);
    setRewardUsd("");
    setProfitShare("");
    setPaymentTerms("on_completion");
    setPriority("normal");
    setTaskKind("");
    setWorkflowStateId(null);
    setAssigneeUserId("");
    setLabelIds([]);
    setCycleId(null);
    setEpisodeId(presetEpisodeId ?? null);
    setComputePoints("");
    setEstimatePoints("");
    setDueDate("");
    setDraft(null);
    draftTask.reset();
  };

  const setOpen = (nextOpen: boolean) => {
    if (!nextOpen && (contractBusy.current || create.isPending || draftTask.isPending)) return;
    onOpenChange(nextOpen);
    if (!nextOpen) reset();
  };

  const generateDraft = async () => {
    if (
      !open ||
      saving ||
      contractBusy.current ||
      operationInFlight.current ||
      create.isPending ||
      draftTask.isPending
    )
      return;
    const prompt = [title.trim(), description.trim()].filter(Boolean).join("\n\n");
    if (!prompt) return;
    operationInFlight.current = true;
    const requestedSession = session.current;
    const requestedRevision = draftRevision.current;
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
      if (session.current !== requestedSession || draftRevision.current !== requestedRevision)
        return;
      setDraft(next);
      // Organizing the brief changes visible content only. Keep saved effort,
      // scheduling and assignment choices; this dialog cannot review AI estimates.
      setTitle(next.title);
      setDescription(next.description);
    } catch (error) {
      if (session.current === requestedSession) {
        toast.error(error instanceof Error ? error.message : t("draftFailed"));
      }
    } finally {
      if (session.current === requestedSession) operationInFlight.current = false;
    }
  };

  const submit = async (action: "create" | "recruit" | "invite" = "create") => {
    const recruit = action === "recruit";
    const invite = action === "invite";
    if ((recruit && !onPublishTask) || (invite && !onInviteTask)) return;
    if (
      !open ||
      contractBusy.current ||
      operationInFlight.current ||
      create.isPending ||
      draftTask.isPending
    )
      return;
    const nextTitle = title.trim();
    if (!nextTitle) {
      titleRef.current?.focus();
      return;
    }
    const missing = missingTaskFields({
      title: nextTitle,
      taskKind: taskKind || null,
      description,
      workflowStateId: resolvedWorkflowStateId ?? undefined,
      rewardCurrency: initialInput?.rewardCurrency ?? CREW_CURRENCY,
      rewardUsdMinor: rewardUsd.trim() ? Number(rewardUsd) * 100 : null,
      profitShareBps: profitShare.trim() ? Math.round(Number(profitShare) * 100) : null,
      dueAt: dueDate || null,
    });
    if (missing.length) {
      toast.error(t("requiredTaskFields", { fields: missing.map((field) => t(field)).join(", ") }));
      return;
    }
    if (!resolvedWorkflowStateId) return;
    if (description.trim().length > 10000) {
      toast.error(t("briefTooLong"));
      return;
    }
    if (
      dueDate &&
      (!onSave || dueDate !== initialInput?.dueAt?.slice(0, 10)) &&
      new Date(`${dueDate}T23:59:59.999`).getTime() < Date.now()
    ) {
      toast.error(projectT("workbench.pastDeadline"));
      return;
    }
    if (
      computePoints !== "" &&
      (!/^\d+$/.test(computePoints) || Number(computePoints) > 2_000_000_000)
    ) {
      toast.error(projectT("workbench.invalidPoints"));
      return;
    }
    if (
      estimatePoints !== "" &&
      (!Number.isInteger(Number(estimatePoints)) ||
        Number(estimatePoints) < 0 ||
        Number(estimatePoints) > 1000000)
    ) {
      toast.error(projectT("workbench.invalidPoints"));
      return;
    }
    if (
      [rewardUsd, profitShare].some(
        (value) => value !== "" && !/^\d+(?:\.\d{1,2})?$/.test(value)
      ) ||
      Number(rewardUsd) > 1_000_000_000 ||
      Number(profitShare) > 100
    ) {
      toast.error(projectT("workbench.invalidCompensation"));
      return;
    }
    if (
      episodeId &&
      (episodes.isLoading ||
        episodes.isError ||
        !episodes.data?.some(
          (episode) => episode.id === episodeId && episode.status !== "cancelled"
        ))
    ) {
      toast.error(t("episodeUnavailable"));
      return;
    }
    operationInFlight.current = true;
    const requestedSession = session.current;
    let staged = false;
    try {
      const input: CreateCrewTaskInput = {
        ...initialInput,
        title: nextTitle,
        description: description.trim(),
        workflowStateId: resolvedWorkflowStateId,
        priority,
        ...(taskKind === "art" ? { assetCategory } : {}),
        ...(taskKind ? { taskKind } : initialInput ? { taskKind: null } : {}),
        dueAt:
          initialInput && dueDate === (initialInput.dueAt?.slice(0, 10) ?? "")
            ? initialInput.dueAt
            : dateEndIso(dueDate || null),
        startAt: draft ? dateStartIso(draft.startDate ?? null) : (initialInput?.startAt ?? null),
        paymentTerms,
        rewardCurrency: initialInput?.rewardCurrency ?? CREW_CURRENCY,
        rewardUsdMinor: rewardUsd === "" ? null : Math.round(Number(rewardUsd) * 100),
        profitShareBps: profitShare === "" ? null : Math.round(Number(profitShare) * 100),
        ...(computePoints !== ""
          ? { computeBudgetPoints: Number(computePoints) }
          : initialInput?.computeBudgetPoints != null
            ? { computeBudgetPoints: null }
            : {}),
        estimatePoints: estimatePoints === "" ? null : Number(estimatePoints),
        revisionLimit: draft?.revisionLimit ?? initialInput?.revisionLimit ?? null,
        cycleId: resolvedCycleId || null,
        episodeId,
        parentId: parentId ?? draft?.parentId ?? initialInput?.parentId ?? null,
        blockedByTaskIds: draft?.blockedByTaskIds ?? initialInput?.blockedByTaskIds ?? [],
        labelIds,
        requiredSkills,
        positionRole: positionRole || null,
        contractAssetNodeId,
        assignees:
          !recruit && !invite && assigneeUserId
            ? initialInput?.assignees[0]?.userId === assigneeUserId
              ? initialInput.assignees
              : [{ userId: assigneeUserId, currency: CREW_CURRENCY }]
            : [],
      };
      if (!onSave) {
        const fingerprint = JSON.stringify(input);
        if (!submission.current || submission.current.fingerprint !== fingerprint)
          submission.current = { fingerprint, key: submissionUuid() };
        input.submissionKey = submission.current.key;
      }
      if (onStage && !recruit && !invite) {
        staged = true;
        onStage(input);
        setOpen(false);
        return;
      }
      const task = onSave
        ? await onSave(input)
        : onStage && onCreateStaged
          ? await onCreateStaged(input)
          : await create.mutateAsync(input);
      if (session.current !== requestedSession) return;
      if (isTaskRequestReceipt(task)) {
        toast.success(t(`approval.${task.status}`));
        submission.current = null;
        setOpen(false);
        return;
      }
      toast.success(t(onSave ? "saved" : "created"));
      onCreated?.(task);
      if (invite) {
        setOpen(false);
        onInviteTask?.(task);
        return;
      }
      if (recruit) {
        setOpen(false);
        onPublishTask?.(task.id);
        return;
      }
      if (createMore && !onSave) {
        reset();
        requestAnimationFrame(() => titleRef.current?.focus());
      } else {
        setOpen(false);
      }
    } catch (error) {
      if (session.current === requestedSession) {
        toast.error(error instanceof Error ? error.message : t("createFailed"));
      }
    } finally {
      if (!staged && session.current === requestedSession) operationInFlight.current = false;
    }
  };

  const activeState = project.workflowStates.find((state) => state.id === resolvedWorkflowStateId);
  const projectLabel = crewName || projectT("title");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/60 supports-backdrop-filter:backdrop-blur-none"
        className={cn(
          "top-[5vh] flex max-h-[90dvh] translate-y-0 flex-col gap-0 overflow-hidden rounded-xl border-[0.5px] border-[#34343a] bg-[#17171a] p-0 text-[#e8e9ec] ring-0 shadow-[0_4px_40px_rgba(0,0,0,.48),0_3px_20px_rgba(0,0,0,.38),0_2px_8px_rgba(0,0,0,.32)] sm:max-w-[896px]",
          expanded && "sm:max-w-[960px]"
        )}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">
          {t(onSave ? "editTask" : initialInput ? "editStagedTask" : "newIssue")}
        </DialogTitle>
        <DialogDescription className="sr-only">{t("newIssueDescription")}</DialogDescription>

        <div className="flex min-h-16 shrink-0 items-center border-b border-white/10 px-5 py-4 text-[13px] font-[450] text-[#e5e6e9]">
          <span className="inline-flex h-6 max-w-40 items-center gap-1.5 rounded-full bg-[#252529] py-0 pr-2 pl-[5px] text-[12px] font-medium leading-3 text-[#a4a4ac]">
            <IconCube className="size-3.5 shrink-0 text-[#e52227]" stroke={1.8} />
            <span className="truncate">{projectLabel}</span>
          </span>
          <IconChevronRight className="mx-1 size-3.5 text-[#66666e]" stroke={1.7} />
          <span>{t(onSave ? "editTask" : initialInput ? "editStagedTask" : "newIssue")}</span>
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

        {!onSave && (onPublishTask || onInviteTask) && (!onStage || onCreateStaged) ? (
          <div className="mx-5 mt-4 flex shrink-0 flex-wrap items-center justify-end gap-2">
            {onInviteTask && (
              <Button
                size="sm"
                variant="outline"
                disabled={contractUploading || create.isPending || draftTask.isPending}
                onClick={() => void submit("invite")}
              >
                {projectT("workbench.createAndInvite")}
              </Button>
            )}
            {onPublishTask && (
              <Button
                size="sm"
                variant="outline"
                disabled={contractUploading || create.isPending || draftTask.isPending}
                onClick={() => void submit("recruit")}
              >
                {projectT("workbench.publishOpening")}
              </Button>
            )}
          </div>
        ) : null}
        <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#92929c]">{t("crewLabel")}</p>
            <div
              className="flex min-h-10 items-center gap-2 rounded-lg bg-[#101012] px-3 py-2 text-sm"
              aria-label={t("crewLabel")}
            >
              <IconCube className="size-3.5 shrink-0 text-primary" />
              <span className="break-words">{projectLabel}</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectChip
              icon={<IconCategory className="size-3.5" />}
              value={taskKind}
              label={taskKind ? t(CREW_TASK_KIND_MESSAGE_KEYS[taskKind]) : t("taskKindLabel")}
              ariaLabel={t("taskKindLabel")}
              required
              onChange={(value) => {
                draftRevision.current += 1;
                const next = value as CrewTaskKind | "";
                setTaskKind(next);
                if (!next || title.trim()) return;
                const template = (templates.data?.items ?? []).find((item) => item.kind === next);
                if (template?.title) setTitle(template.title);
              }}
              options={[
                { value: "", label: t("taskKindUnset") },
                ...CREW_TASK_KINDS.map((kind) => ({
                  value: kind,
                  label: t(CREW_TASK_KIND_MESSAGE_KEYS[kind]),
                })),
              ]}
            />
            {taskKind === "art" && (
              <SelectChip
                icon={<IconCategory className="size-3.5" />}
                value={assetCategory}
                label={t(`assetCategory_${assetCategory}`)}
                ariaLabel={t("assetCategory")}
                onChange={(value) => {
                  draftRevision.current += 1;
                  setAssetCategory(value as typeof assetCategory);
                }}
                options={["characters", "scenes", "props", "art"].map((value) => ({
                  value,
                  label: t(`assetCategory_${value}`),
                }))}
              />
            )}
            <SelectChip
              icon={<IconUserCircle className="size-3.5" />}
              value={positionRole}
              label={
                positions.find((role) => role.value === positionRole)?.label ??
                (positionRole || t("positionRole"))
              }
              ariaLabel={t("positionRole")}
              onChange={(value) => {
                draftRevision.current += 1;
                setPositionRole(value);
              }}
              options={[
                { value: "", label: t("positionRole") },
                ...positions,
                ...(positionRole && !positions.some((role) => role.value === positionRole)
                  ? [{ value: positionRole, label: positionRole }]
                  : []),
              ]}
            />
            <SelectChip
              icon={<IconFlag3 className="size-3.5" />}
              value={priority}
              label={t(`priority.${priority}`)}
              ariaLabel={t("priorityLabel")}
              onChange={(value) => {
                draftRevision.current += 1;
                setPriority(value as CrewTaskPriority);
              }}
              options={(["urgent", "high", "normal", "low"] as const).map((value) => ({
                value,
                label: t(`priority.${value}`),
              }))}
            />
          </div>
          <label className="block space-y-2">
            <span className="text-sm font-medium">
              {t("taskTitle")}{" "}
              <span aria-hidden="true" className="text-primary">
                *
              </span>
            </span>
            <textarea
              ref={titleRef}
              value={title}
              onChange={(event) => {
                draftRevision.current += 1;
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
              aria-required="true"
              className="block min-h-11 w-full resize-y rounded-md border border-white/15 bg-[#0b0c0f] p-3 text-sm text-white outline-none focus:border-primary"
            />
          </label>
          <div className="relative">
            <label className="block space-y-2">
              <span className="text-sm font-medium">
                {t("taskBrief")}{" "}
                <span aria-hidden="true" className="text-primary">
                  *
                </span>
              </span>
              <textarea
                value={description}
                onChange={(event) => {
                  draftRevision.current += 1;
                  setDescription(event.target.value);
                  setDraft(null);
                }}
                rows={2}
                maxLength={10_000}
                placeholder={t("descriptionPlaceholder")}
                aria-label={t("taskBrief")}
                aria-required="true"
                className={cn(
                  "block min-h-36 w-full resize-y rounded-lg border-2 border-dashed border-white/15 bg-[#0b0c0f] p-3 text-sm leading-6 text-[#d5d5da] outline-none focus:border-primary",
                  expanded && "min-h-52"
                )}
              />
            </label>
            <div className="mt-1 flex items-center justify-between gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                color="muted"
                disabled={!title.trim() || create.isPending}
                loading={draftTask.isPending}
                onClick={() => void generateDraft()}
                className="h-6 rounded-full px-2 text-[11px] text-[#a4a4ac] hover:bg-[#252529] hover:text-[#d8d8dd]"
                icon={<IconSparkles className="size-3.5 text-[#7f8cff]" />}
              >
                {t("organizeWithAi")}
              </Button>
              {draft?.questions.length ? (
                <p className="truncate text-[10px] text-amber-100/75">
                  {draft.questions.join(" · ")}
                </p>
              ) : null}
            </div>
          </div>

          <label className="block text-sm">
            {projectT("workbench.initialComputePoints")}
            <Input
              type="number"
              min={0}
              max={2_000_000_000}
              step={1}
              value={computePoints}
              onChange={(e) => setComputePoints(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              {projectT("workbench.initialComputeHint")}
            </span>
          </label>
          <section className="text-xs text-muted-foreground">
            <div className="mt-2 max-w-sm">
              <SelectChip
                icon={<IconUserCircle className="size-3.5" />}
                value={assigneeUserId}
                label={assigneeUserId ? displayNameOf(assigneeUserId, displays) : t("unassigned")}
                ariaLabel={t("chooseAssignees")}
                onChange={(value) => {
                  draftRevision.current += 1;
                  setAssigneeUserId(value);
                }}
                options={[
                  { value: "", label: t("unassigned") },
                  ...members.map((member) => ({
                    value: member.userId,
                    label: displayNameOf(member.userId, displays),
                  })),
                ]}
              />
            </div>
          </section>

          <section className="space-y-2" aria-label={t("contractOptional")}>
            <h3 className="text-xs font-medium text-muted-foreground">{t("contractOptional")}</h3>
            <TaskDeliveryUpload
              key={`${actorId}:${crewId}:${parentId}:${open}:${contractUploadRevision}`}
              crewId={crewId}
              parentId={null}
              label={t("contractOptional")}
              disabled={create.isPending || draftTask.isPending}
              onBusyChange={(busy) => {
                contractBusy.current = busy;
                setContractUploading(busy);
              }}
              onUploaded={(asset) => {
                setContractAssetNodeId(asset.id);
                setContractFilename(asset.name);
              }}
            />
            {contractAssetNodeId ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {contractFilename ? <span className="break-all">{contractFilename}</span> : null}
                <TaskContractLink crewId={crewId} assetId={contractAssetNodeId} />
                <Button
                  size="sm"
                  variant="ghost"
                  color="muted"
                  disabled={contractUploading || create.isPending || draftTask.isPending}
                  onClick={() => {
                    setContractAssetNodeId(null);
                    setContractFilename("");
                  }}
                >
                  {t("removeContract")}
                </Button>
              </div>
            ) : null}
          </section>

          <RequiredSkillsSelect
            value={requiredSkills}
            onChange={setRequiredSkills}
            disabled={contractUploading || create.isPending || draftTask.isPending}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectChip
              icon={<StateRing color={activeState?.color} />}
              value={resolvedWorkflowStateId}
              label={activeState ? workflowStateLabel(activeState, projectT) : t("planningState")}
              ariaLabel={t("planningState")}
              onChange={setWorkflowStateId}
              options={creationStates.map((state) => ({
                value: state.id,
                label: workflowStateLabel(state, projectT),
              }))}
            />
            {(
              [
                { key: "rewardUsd", value: rewardUsd, set: setRewardUsd, max: 1_000_000_000 },
                { key: "profitShare", value: profitShare, set: setProfitShare, max: 100 },
              ] as const
            ).map((field) => (
              <label key={field.key} className="block min-w-0 space-y-2">
                <span className="flex items-center gap-2 text-xs font-medium text-[#92929c]">
                  <IconCoin className="size-3.5" />
                  {projectT(`workbench.${field.key}`, {
                    currency: initialInput?.rewardCurrency ?? CREW_CURRENCY,
                  })}{" "}
                  {field.key === "rewardUsd" && (
                    <span aria-hidden="true" className="text-primary">
                      *
                    </span>
                  )}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]+([.][0-9]{1,2})?"
                  value={field.value}
                  aria-label={projectT(`workbench.${field.key}`, {
                    currency: initialInput?.rewardCurrency ?? CREW_CURRENCY,
                  })}
                  aria-required={field.key === "rewardUsd"}
                  className="h-10 data-[size=default]:h-10 w-full min-w-0 rounded-lg border border-white/10 bg-[#101012] px-3 text-sm text-white outline-none focus:border-primary"
                  onChange={(event) => {
                    draftRevision.current += 1;
                    const value = event.target.value;
                    if (/^\d*(?:\.\d{0,2})?$/.test(value) && Number(value || 0) <= field.max)
                      field.set(value);
                  }}
                />
              </label>
            ))}
            <div className="min-w-0 space-y-2">
              <SelectChip
                icon={<IconCoin className="size-3.5" />}
                value={paymentTerms}
                label={paymentT(paymentTerms)}
                ariaLabel={paymentT("label")}
                help={<TaskPaymentHelp />}
                onChange={(value) => {
                  const term = TASK_PAYMENT_TERMS.find((item) => item === value);
                  if (term) {
                    draftRevision.current += 1;
                    setPaymentTerms(term);
                  }
                }}
                options={CURRENT_TASK_PAYMENT_TERMS.map((value) => ({
                  value,
                  label: paymentT(value),
                }))}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <p className="flex items-center gap-2 text-xs font-medium text-[#92929c]">
                <IconCalendar className="size-3.5" />
                {t("due")}{" "}
                <span aria-hidden="true" className="text-primary">
                  *
                </span>
              </p>
              <DateChip
                value={dueDate}
                onChange={(value) => {
                  draftRevision.current += 1;
                  setDueDate(value);
                }}
              />
            </div>
          </div>
        </div>

        <footer className="flex min-h-16 shrink-0 items-center justify-end border-t border-white/10 px-5 py-4 sm:px-8">
          {!onStage && !onSave ? (
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
          ) : null}
          <button
            type="button"
            disabled={
              saving ||
              contractUploading ||
              !resolvedWorkflowStateId ||
              draftTask.isPending ||
              create.isPending
            }
            onClick={() => void submit()}
            className="ml-5 inline-flex h-11 min-w-32 items-center justify-center rounded-lg bg-[#E52227] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#c91c21] disabled:cursor-not-allowed disabled:bg-[#34343a] disabled:text-[#777780]"
          >
            {saving
              ? t("saving")
              : onSave
                ? t("saveChanges")
                : create.isPending
                  ? t("creating")
                  : onStage
                    ? initialInput
                      ? t("saveStagedTask")
                      : projectT("workbench.stage")
                    : t("createTask")}
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
  required,
  help,
}: {
  help?: React.ReactNode;
  required?: boolean;
  icon: React.ReactNode;
  value: string;
  label: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="flex items-center gap-2 text-xs font-medium text-[#92929c]">
        {icon}
        {ariaLabel}
        {help ? (
          <span className="relative inline-flex size-4 shrink-0 items-center justify-center [&>button]:absolute">
            {help}
          </span>
        ) : null}
        {required ? (
          <span aria-hidden="true" className="text-primary">
            *
          </span>
        ) : null}
      </p>
      <TaskSelect
        value={value}
        onValueChange={onChange}
        options={options}
        ariaLabel={ariaLabel}
        displayValue={<span className="truncate">{label}</span>}
        className="h-10 data-[size=default]:h-10 w-full min-w-0 rounded-lg border border-white/10 bg-[#101012] px-3 text-sm text-[#e8e9ec] hover:bg-white/5 dark:bg-[#101012]"
      />
    </div>
  );
}

function DateChip({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useTranslations("crewTasks");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const date = value ? new Date(`${value}T12:00:00`) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("due")}
          className="inline-flex h-10 w-full items-center gap-2 rounded-lg border border-white/10 bg-[#101012] px-3 text-sm text-[#a4a4ac]"
        >
          {date && !Number.isNaN(date.getTime())
            ? new Intl.DateTimeFormat(locale, {
                year: "numeric",
                month: "short",
                day: "numeric",
              }).format(date)
            : t("due")}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto border-white/15 bg-[#151618] p-2" align="end">
        <Calendar
          mode="single"
          disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }}
          locale={locale === "zh-CN" ? zhCN : locale === "zh-HK" ? zhHK : enUS}
          selected={date}
          onSelect={(next) => {
            onChange(
              next
                ? `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`
                : ""
            );
            setOpen(false);
          }}
        />
        <button
          type="button"
          className="w-full rounded p-2 text-xs hover:bg-white/5"
          onClick={() => {
            onChange("");
            setOpen(false);
          }}
        >
          {t("clear")}
        </button>
      </PopoverContent>
    </Popover>
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

function dateStartIso(value: string | null): string | null {
  return value ? new Date(`${value}T00:00:00`).toISOString() : null;
}

function dateEndIso(value: string | null): string | null {
  return value ? new Date(`${value}T23:59:59`).toISOString() : null;
}
