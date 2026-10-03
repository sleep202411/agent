"use client";

import { workflowStateLabel } from "@/app/(site)/crews/_lib/workflow-state-label";

import { useLayoutEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import {
  IconArchive,
  IconArrowLeft,
  IconArrowRight,
  IconColumns3,
  IconGitBranch,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTag,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";

import {
  useCreateCrewTaskCycle,
  useCreateCrewTaskField,
  useCreateCrewTaskLabel,
  useDeleteCrewTaskCycle,
  useDeleteCrewTaskField,
  useDeleteCrewTaskLabel,
  useDeleteCrewTaskWorkflowState,
  useReorderCrewTaskWorkflowStates,
  useUpdateCrewTaskCycle,
  useUpdateCrewTaskField,
  useUpdateCrewTaskLabel,
  useUpdateCrewTaskWorkflowState,
  type CrewTaskCycleDTO,
  type CrewTaskFieldDTO,
  type CrewTaskFieldType,
  type CrewTaskLabelDTO,
  type CrewTaskProjectDTO,
  type CrewTaskWorkflowStateDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { TaskSelect } from "./task-select";

type SettingsSection = "workflow" | "cycles" | "labels" | "fields";

export function ProjectSettingsDialog(props: Parameters<typeof ProjectSettingsSession>[0]) {
  const { user } = useCurrentUser();
  return props.open ? (
    <ProjectSettingsSession key={JSON.stringify([user?.id, props.crewId])} {...props} />
  ) : null;
}

function useSettingsAction() {
  const current = useRef({ alive: true, pending: false });
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    const session = current.current;
    session.alive = true;
    return () => {
      session.alive = false;
    };
  }, []);
  return {
    busy,
    active: () => current.current.alive,
    start: () => {
      if (!current.current.alive || current.current.pending) return false;
      current.current.pending = true;
      setBusy(true);
      return true;
    },
    finish: () => {
      current.current.pending = false;
      if (current.current.alive) setBusy(false);
    },
  };
}

function ProjectSettingsSession({
  crewId,
  project,
  open,
  onOpenChange,
  onEditWorkflowState,
}: {
  crewId: string;
  project: CrewTaskProjectDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditWorkflowState: (state: CrewTaskWorkflowStateDTO) => void;
}) {
  const t = useTranslations("crewTaskProject");
  const [section, setSection] = useState<SettingsSection>("workflow");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden border-white/[0.1] bg-[#141417] p-0 text-[#e7e8eb] sm:max-w-4xl">
        <DialogHeader className="border-b border-white/[0.07] px-6 py-5">
          <DialogTitle>{t("projectSettings")}</DialogTitle>
          <DialogDescription>{t("projectSettingsDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid min-h-[520px] p-0 md:grid-cols-[190px_minmax(0,1fr)]">
          <nav className="space-y-1 border-r border-white/[0.07] bg-[#101013] p-3">
            <SettingsNav
              active={section === "workflow"}
              icon={<IconGitBranch />}
              label={t("workflowColumns")}
              count={project.workflowStates.filter((state) => !state.archived).length}
              onClick={() => setSection("workflow")}
            />
            <SettingsNav
              active={section === "cycles"}
              icon={<IconColumns3 />}
              label={t("cycles")}
              count={project.cycles.length}
              onClick={() => setSection("cycles")}
            />
            <SettingsNav
              active={section === "labels"}
              icon={<IconTag />}
              label={t("labels")}
              count={project.labels.length}
              onClick={() => setSection("labels")}
            />
            <SettingsNav
              active={section === "fields"}
              icon={<IconColumns3 />}
              label={t("customFields")}
              count={project.fields.length}
              onClick={() => setSection("fields")}
            />
          </nav>
          <div className="max-h-[68vh] overflow-y-auto p-6">
            {section === "workflow" ? (
              <WorkflowPanel crewId={crewId} project={project} onEdit={onEditWorkflowState} />
            ) : section === "cycles" ? (
              <CyclesPanel crewId={crewId} cycles={project.cycles} />
            ) : section === "labels" ? (
              <LabelsPanel crewId={crewId} labels={project.labels} />
            ) : (
              <FieldsPanel crewId={crewId} fields={project.fields} />
            )}
          </div>
        </DialogBody>
        <DialogFooter className="border-t border-white/[0.07] px-6 py-4">
          <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {t("done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkflowPanel({
  crewId,
  project,
  onEdit,
}: {
  crewId: string;
  project: CrewTaskProjectDTO;
  onEdit: (state: CrewTaskWorkflowStateDTO) => void;
}) {
  const t = useTranslations("crewTaskProject");
  const action = useSettingsAction();
  const updateState = useUpdateCrewTaskWorkflowState(crewId);
  const reorderStates = useReorderCrewTaskWorkflowStates(crewId);
  const deleteState = useDeleteCrewTaskWorkflowState(crewId);
  const [archiveTargetId, setArchiveTargetId] = useState<string | null>(null);
  const [replacementStateId, setReplacementStateId] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const activeStates = project.workflowStates.filter((state) => !state.archived);
  const archiveTarget =
    project.workflowStates.find((state) => state.id === archiveTargetId) ?? null;
  const replacementCandidates = archiveTarget
    ? activeStates.filter(
        (state) => state.id !== archiveTarget.id && state.semantic === archiveTarget.semantic
      )
    : [];
  const pending = action.busy;

  const moveState = async (stateId: string, direction: -1 | 1) => {
    const index = activeStates.findIndex((state) => state.id === stateId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= activeStates.length) return;
    const ordered = [...activeStates];
    [ordered[index], ordered[destination]] = [ordered[destination], ordered[index]];
    if (!action.start()) return;
    try {
      await reorderStates.mutateAsync(
        ordered.map((state) => ({ id: state.id, expectedVersion: state.version }))
      );
      if (!action.active()) return;
      toast.success(t("workflowColumnsReordered"));
    } catch (error) {
      if (!action.active()) return;
      toast.error(error instanceof Error ? error.message : t("workflowColumnSaveFailed"));
    } finally {
      action.finish();
    }
  };

  const archiveState = async () => {
    if (!archiveTarget) return;
    const taskCount = archiveTarget.taskCount ?? 0;
    if (taskCount > 0 && !replacementStateId) return;
    if (!action.start()) return;
    try {
      await updateState.mutateAsync({
        stateId: archiveTarget.id,
        input: {
          expectedVersion: archiveTarget.version,
          archived: true,
          replacementStateId: replacementStateId || undefined,
        },
      });
      if (!action.active()) return;
      setArchiveTargetId(null);
      setReplacementStateId("");
      toast.success(t("workflowColumnArchived"));
    } catch (error) {
      if (!action.active()) return;
      toast.error(error instanceof Error ? error.message : t("workflowColumnSaveFailed"));
    } finally {
      action.finish();
    }
  };

  const restoreState = async (state: CrewTaskWorkflowStateDTO) => {
    if (!action.start()) return;
    try {
      await updateState.mutateAsync({
        stateId: state.id,
        input: { expectedVersion: state.version, archived: false },
      });
      if (!action.active()) return;
      toast.success(t("workflowColumnRestored"));
    } catch (error) {
      if (!action.active()) return;
      toast.error(error instanceof Error ? error.message : t("workflowColumnSaveFailed"));
    } finally {
      action.finish();
    }
  };

  const permanentlyDeleteState = async (state: CrewTaskWorkflowStateDTO) => {
    if (deleteConfirmId !== state.id) {
      setDeleteConfirmId(state.id);
      return;
    }
    if (!action.start()) return;
    try {
      await deleteState.mutateAsync(state.id);
      if (!action.active()) return;
      setDeleteConfirmId(null);
      toast.success(t("workflowColumnDeleted"));
    } catch (error) {
      if (!action.active()) return;
      toast.error(error instanceof Error ? error.message : t("workflowColumnDeleteFailed"));
    } finally {
      action.finish();
    }
  };

  return (
    <fieldset disabled={action.busy} className="contents">
      {" "}
      <SettingsPanel
        title={t("workflowManagement")}
        description={t("workflowManagementDescription")}
      >
        <div className="divide-y divide-white/[0.07] overflow-hidden rounded-xl border border-white/[0.08]">
          {project.workflowStates.map((state) => {
            const activeIndex = activeStates.findIndex((item) => item.id === state.id);
            const taskCount = state.taskCount ?? 0;
            const isArchiveTarget = archiveTargetId === state.id;
            return (
              <div key={state.id} className="bg-white/[0.015]">
                <div className="flex items-center gap-3 px-3 py-3">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: state.color }}
                  />
                  <button
                    type="button"
                    onClick={() => onEdit(state)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[12px] font-medium">
                        {workflowStateLabel(state, t)}
                      </span>
                      {state.archived ? (
                        <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-[#858b95]">
                          {t("workflowArchived")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-[10px] text-[#747a84]">
                      {t(`workflowBehaviorHelp.${state.semantic}`)} ·{" "}
                      {t("workflowColumnTaskCount", { count: taskCount })}
                    </p>
                  </button>
                  {!state.archived ? (
                    <>
                      <ActionButton
                        label={t("moveColumnLeft")}
                        disabled={pending || activeIndex <= 0}
                        onClick={() => void moveState(state.id, -1)}
                      >
                        <IconArrowLeft />
                      </ActionButton>
                      <ActionButton
                        label={t("moveColumnRight")}
                        disabled={pending || activeIndex === activeStates.length - 1}
                        onClick={() => void moveState(state.id, 1)}
                      >
                        <IconArrowRight />
                      </ActionButton>
                    </>
                  ) : null}
                  <ActionButton
                    label={t("editWorkflowColumnTitle")}
                    disabled={pending}
                    onClick={() => onEdit(state)}
                  >
                    <IconPencil />
                  </ActionButton>
                  {state.archived ? (
                    <ActionButton
                      label={t("restoreColumn")}
                      disabled={pending}
                      onClick={() => void restoreState(state)}
                    >
                      <IconRefresh />
                    </ActionButton>
                  ) : (
                    <ActionButton
                      label={t("archiveColumn")}
                      disabled={pending || activeStates.length <= 1}
                      onClick={() => {
                        setArchiveTargetId(isArchiveTarget ? null : state.id);
                        setReplacementStateId("");
                      }}
                    >
                      <IconArchive />
                    </ActionButton>
                  )}
                  {state.archived && !state.systemKey ? (
                    <button
                      type="button"
                      disabled={pending || taskCount > 0}
                      onClick={() => void permanentlyDeleteState(state)}
                      className={cn(
                        "h-7 rounded-md px-2 text-[9px] transition-colors disabled:cursor-not-allowed disabled:opacity-35",
                        deleteConfirmId === state.id
                          ? "bg-[#e52227]/16 text-red-300"
                          : "text-[#777d87] hover:bg-[#e52227]/10 hover:text-red-300"
                      )}
                      title={
                        taskCount > 0
                          ? t("workflowDeleteNeedsEmpty")
                          : t("deleteWorkflowColumnConfirm", { name: state.name })
                      }
                    >
                      {deleteConfirmId === state.id
                        ? t("deleteWorkflowColumnConfirmAction")
                        : t("deleteColumn")}
                    </button>
                  ) : null}
                </div>
                {isArchiveTarget ? (
                  <div className="border-t border-white/[0.06] bg-black/10 px-3 py-3">
                    <p className="text-[10px] text-[#9298a2]">
                      {t("archiveWorkflowColumnPrompt", {
                        name: workflowStateLabel(state, t),
                      })}
                    </p>
                    {taskCount > 0 ? (
                      replacementCandidates.length ? (
                        <label className="mt-3 flex items-center gap-3 text-[10px] text-[#858b95]">
                          <span>{t("archiveMoveTasksTo")}</span>
                          <TaskSelect
                            value={replacementStateId}
                            onValueChange={setReplacementStateId}
                            ariaLabel={t("archiveMoveTasksTo")}
                            className="h-8 min-w-0 flex-1 rounded-md border border-white/[0.09] bg-[#0d0e11] px-2 text-[10px] text-[#c4c8cf]"
                            options={[
                              { value: "", label: t("selectWorkflowColumn") },
                              ...replacementCandidates.map((candidate) => ({
                                value: candidate.id,
                                label: workflowStateLabel(candidate, t),
                              })),
                            ]}
                          />
                        </label>
                      ) : (
                        <p className="mt-2 text-[10px] text-amber-300/75">
                          {t("archiveNeedsMatchingColumn")}
                        </p>
                      )
                    ) : null}
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        color="muted"
                        onClick={() => setArchiveTargetId(null)}
                      >
                        {t("cancel")}
                      </Button>
                      <Button
                        size="sm"
                        loading={action.busy}
                        disabled={taskCount > 0 && !replacementStateId}
                        onClick={() => void archiveState()}
                      >
                        {t("archiveColumn")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="text-[10px] leading-5 text-[#747a84]">{t("workflowSettingsHint")}</p>
      </SettingsPanel>
    </fieldset>
  );
}

function ActionButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactElement<{ className?: string }>;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 shrink-0 place-items-center rounded-md text-[#717781] transition-colors hover:bg-white/[0.055] hover:text-[#d5d8dd] disabled:cursor-not-allowed disabled:opacity-25 [&>svg]:size-3.5"
    >
      {children}
    </button>
  );
}

function CyclesPanel({ crewId, cycles }: { crewId: string; cycles: CrewTaskCycleDTO[] }) {
  const t = useTranslations("crewTaskProject");
  const action = useSettingsAction();
  const createCycle = useCreateCrewTaskCycle(crewId);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");

  const create = async () => {
    if (!action.start()) return;
    try {
      await createCycle.mutateAsync({
        name: name.trim(),
        goal: goal.trim(),
        startAt: dateStartIso(startAt),
        endAt: dateEndIso(endAt),
      });
      if (!action.active()) return;
      setName("");
      setGoal("");
      setStartAt("");
      setEndAt("");
      toast.success(t("cycleSaved"));
    } catch (error) {
      if (!action.active()) return;
      toast.error(error instanceof Error ? error.message : t("cycleCreateFailed"));
    } finally {
      action.finish();
    }
  };

  return (
    <fieldset disabled={action.busy} className="contents">
      {" "}
      <SettingsPanel title={t("cycleManagement")} description={t("cycleManagementDescription")}>
        <div className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.018] p-3">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("cycleName")}
          />
          <Textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder={t("cycleGoal")}
            className="min-h-16"
          />
          <div className="grid grid-cols-2 gap-2">
            <DateField label={t("startAt")} value={startAt} onChange={setStartAt} />
            <DateField label={t("endAt")} value={endAt} onChange={setEndAt} />
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              icon={<IconPlus />}
              loading={action.busy}
              disabled={!name.trim() || !startAt || !endAt || endAt < startAt}
              onClick={() => void create()}
            >
              {t("createCycle")}
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          {cycles.length ? (
            cycles.map((cycle) => <CycleRow key={cycle.id} crewId={crewId} cycle={cycle} />)
          ) : (
            <EmptyState text={t("noCycles")} />
          )}
        </div>
      </SettingsPanel>
    </fieldset>
  );
}

function CycleRow({ crewId, cycle }: { crewId: string; cycle: CrewTaskCycleDTO }) {
  const t = useTranslations("crewTaskProject");
  const action = useSettingsAction();
  const updateCycle = useUpdateCrewTaskCycle(crewId);
  const deleteCycle = useDeleteCrewTaskCycle(crewId);
  const [editing, setEditing] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [name, setName] = useState(cycle.name);
  const [goal, setGoal] = useState(cycle.goal);
  const [status, setStatus] = useState(cycle.status);
  const [startAt, setStartAt] = useState(toDateInput(cycle.startAt));
  const [endAt, setEndAt] = useState(toDateInput(cycle.endAt));

  const [editUpdatedAt, setEditUpdatedAt] = useState(cycle.updatedAt);
  const startEditing = () => {
    if (action.busy) return;
    setName(cycle.name);
    setGoal(cycle.goal);
    setStatus(cycle.status);
    setStartAt(toDateInput(cycle.startAt));
    setEndAt(toDateInput(cycle.endAt));
    setEditUpdatedAt(cycle.updatedAt);
    setDeleteArmed(false);
    setEditing(true);
  };

  const save = async () => {
    if (!action.start()) return;
    try {
      await updateCycle.mutateAsync({
        cycleId: cycle.id,
        input: {
          expectedUpdatedAt: editUpdatedAt,
          name: name.trim(),
          goal: goal.trim(),
          status,
          startAt: dateStartIso(startAt),
          endAt: dateEndIso(endAt),
        },
      });
      if (!action.active()) return;
      setEditing(false);
      toast.success(t("cycleSaved"));
    } catch (error) {
      if (!action.active()) return;
      toast.error(error instanceof Error ? error.message : t("cycleUpdateFailed"));
    } finally {
      action.finish();
    }
  };

  const remove = async () => {
    if (!deleteArmed) return setDeleteArmed(true);
    if (!action.start()) return;
    try {
      await deleteCycle.mutateAsync(cycle.id);
      if (!action.active()) return;
      toast.success(t("cycleDeleted"));
    } catch (error) {
      if (!action.active()) return;
      setDeleteArmed(false);
      toast.error(error instanceof Error ? error.message : t("cycleDeleteFailed"));
    } finally {
      action.finish();
    }
  };

  return (
    <fieldset disabled={action.busy} className="contents">
      {" "}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] p-3">
        {editing ? (
          <div className="space-y-2">
            <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-2">
              <Input value={name} onChange={(event) => setName(event.target.value)} />
              <TaskSelect
                value={status}
                onValueChange={(nextValue) => setStatus(nextValue as CrewTaskCycleDTO["status"])}
                options={(["planned", "active", "completed", "cancelled"] as const).map(
                  (value) => ({
                    value,
                    label: t(`cycleStatus.${value}`),
                  })
                )}
              />
            </div>
            <Textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              className="min-h-16"
            />
            <div className="grid grid-cols-2 gap-2">
              <DateField label={t("startAt")} value={startAt} onChange={setStartAt} />
              <DateField label={t("endAt")} value={endAt} onChange={setEndAt} />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" color="muted" onClick={() => setEditing(false)}>
                {t("cancel")}
              </Button>
              <Button
                size="sm"
                loading={action.busy}
                disabled={!name.trim() || !startAt || !endAt || endAt < startAt}
                onClick={() => void save()}
              >
                {t("save")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] text-[#777d87]">C{cycle.number}</span>
                <span className="truncate text-[12px] font-medium">{cycle.name}</span>
                <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-[#9297a0]">
                  {t(`cycleStatus.${cycle.status}`)}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#777d87]">
                {cycle.goal || t("noCycleGoal")}
              </p>
            </div>
            <IconButton label={t("edit")} onClick={startEditing}>
              <IconPencil />
            </IconButton>
            <IconButton
              label={deleteArmed ? t("confirmDeleteCycle") : t("delete")}
              destructive={deleteArmed}
              disabled={action.busy}
              onClick={() => void remove()}
            >
              <IconTrash />
            </IconButton>
          </div>
        )}
      </div>
    </fieldset>
  );
}

function LabelsPanel({ crewId, labels }: { crewId: string; labels: CrewTaskLabelDTO[] }) {
  const t = useTranslations("crewTaskProject");
  const action = useSettingsAction();
  const createLabel = useCreateCrewTaskLabel(crewId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#e12b32");

  const create = async () => {
    if (!action.start()) return;
    try {
      await createLabel.mutateAsync({ name: name.trim(), description: description.trim(), color });
      if (!action.active()) return;
      setName("");
      setDescription("");
      toast.success(t("labelCreated"));
    } catch (error) {
      if (!action.active()) return;
      toast.error(error instanceof Error ? error.message : t("labelCreateFailed"));
    } finally {
      action.finish();
    }
  };

  return (
    <fieldset disabled={action.busy} className="contents">
      {" "}
      <SettingsPanel title={t("labelManagement")} description={t("labelManagementDescription")}>
        <div className="grid grid-cols-[40px_minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-2">
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="h-9 w-10 rounded-md border border-white/[0.1] bg-transparent p-1"
            aria-label={t("labelColor")}
          />
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("labelName")}
          />
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("labelDescription")}
          />
          <Button
            size="sm"
            disabled={!name.trim()}
            loading={action.busy}
            onClick={() => void create()}
          >
            {t("addLabel")}
          </Button>
        </div>
        <div className="divide-y divide-white/[0.07] overflow-hidden rounded-xl border border-white/[0.08]">
          {labels.length ? (
            labels.map((label) => <LabelRow key={label.id} crewId={crewId} label={label} />)
          ) : (
            <EmptyState text={t("noLabels")} />
          )}
        </div>
      </SettingsPanel>
    </fieldset>
  );
}

function LabelRow({ crewId, label }: { crewId: string; label: CrewTaskLabelDTO }) {
  const t = useTranslations("crewTaskProject");
  const action = useSettingsAction();
  const updateLabel = useUpdateCrewTaskLabel(crewId);
  const deleteLabel = useDeleteCrewTaskLabel(crewId);
  const [editing, setEditing] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [name, setName] = useState(label.name);
  const [description, setDescription] = useState(label.description);
  const [color, setColor] = useState(label.color);

  const [editUpdatedAt, setEditUpdatedAt] = useState(label.updatedAt);
  const startEditing = () => {
    if (action.busy) return;
    setName(label.name);
    setDescription(label.description);
    setColor(label.color);
    setEditUpdatedAt(label.updatedAt);
    setDeleteArmed(false);
    setEditing(true);
  };

  const save = async () => {
    if (!action.start()) return;
    try {
      await updateLabel.mutateAsync({
        labelId: label.id,
        input: {
          expectedUpdatedAt: editUpdatedAt,
          name: name.trim(),
          description: description.trim(),
          color,
        },
      });
      if (!action.active()) return;
      setEditing(false);
      toast.success(t("labelSaved"));
    } catch (error) {
      if (!action.active()) return;
      toast.error(error instanceof Error ? error.message : t("labelSaveFailed"));
    } finally {
      action.finish();
    }
  };

  const remove = async () => {
    if (!deleteArmed) return setDeleteArmed(true);
    if (!action.start()) return;
    try {
      await deleteLabel.mutateAsync(label.id);
      if (!action.active()) return;
      toast.success(t("labelDeleted"));
    } catch (error) {
      if (!action.active()) return;
      setDeleteArmed(false);
      toast.error(error instanceof Error ? error.message : t("labelDeleteFailed"));
    } finally {
      action.finish();
    }
  };

  return (
    <fieldset disabled={action.busy} className="contents">
      {" "}
      <div className="bg-white/[0.015] p-3">
        {editing ? (
          <div className="space-y-2">
            <div className="grid grid-cols-[40px_minmax(0,1fr)] gap-2">
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="h-9 w-10 rounded-md border border-white/[0.1] bg-transparent p-1"
              />
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <Input value={description} onChange={(event) => setDescription(event.target.value)} />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" color="muted" onClick={() => setEditing(false)}>
                {t("cancel")}
              </Button>
              <Button
                size="sm"
                disabled={!name.trim()}
                loading={action.busy}
                onClick={() => void save()}
              >
                {t("save")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: label.color }} />
            <span className="text-[12px] font-medium">{label.name}</span>
            <span className="min-w-0 flex-1 truncate text-[10px] text-[#777d87]">
              {label.description || t("noLabelDescription")}
            </span>
            <IconButton label={t("edit")} onClick={startEditing}>
              <IconPencil />
            </IconButton>
            <IconButton
              label={deleteArmed ? t("confirmDelete") : t("delete")}
              destructive={deleteArmed}
              disabled={action.busy}
              onClick={() => void remove()}
            >
              <IconTrash />
            </IconButton>
          </div>
        )}
      </div>
    </fieldset>
  );
}

function FieldsPanel({ crewId, fields }: { crewId: string; fields: CrewTaskFieldDTO[] }) {
  const t = useTranslations("crewTaskProject");
  const action = useSettingsAction();
  const createField = useCreateCrewTaskField(crewId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<CrewTaskFieldType>("text");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);
  const supportsOptions = type === "single_select" || type === "multi_select";

  const create = async () => {
    if (!action.start()) return;
    try {
      await createField.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        type,
        required,
        options: supportsOptions
          ? uniqueLabels(options).map((label) => ({ id: crypto.randomUUID(), label }))
          : [],
      });
      if (!action.active()) return;
      setName("");
      setDescription("");
      setOptions("");
      setRequired(false);
      toast.success(t("customFieldCreated"));
    } catch (error) {
      if (!action.active()) return;
      toast.error(error instanceof Error ? error.message : t("customFieldCreateFailed"));
    } finally {
      action.finish();
    }
  };

  return (
    <fieldset disabled={action.busy} className="contents">
      {" "}
      <SettingsPanel
        title={t("customFieldManagement")}
        description={t("customFieldManagementDescription")}
      >
        <div className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.018] p-3">
          <div className="grid grid-cols-[minmax(0,1fr)_160px] gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("customFieldName")}
            />
            <TaskSelect
              value={type}
              onValueChange={(nextValue) => setType(nextValue as CrewTaskFieldType)}
              options={(
                [
                  "text",
                  "number",
                  "single_select",
                  "multi_select",
                  "date",
                  "checkbox",
                  "user",
                ] as const
              ).map((value) => ({ value, label: t(`customFieldType.${value}`) }))}
            />
          </div>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("customFieldDescription")}
          />
          {supportsOptions ? (
            <Input
              value={options}
              onChange={(event) => setOptions(event.target.value)}
              placeholder={t("customFieldOptions")}
            />
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-[10px] text-[#858b95]">
              <input
                type="checkbox"
                checked={required}
                onChange={(event) => setRequired(event.target.checked)}
              />
              {t("customFieldRequired")}
            </label>
            <Button
              size="sm"
              icon={<IconPlus />}
              disabled={!name.trim() || (supportsOptions && uniqueLabels(options).length === 0)}
              loading={action.busy}
              onClick={() => void create()}
            >
              {t("addCustomField")}
            </Button>
          </div>
        </div>
        <div className="divide-y divide-white/[0.07] overflow-hidden rounded-xl border border-white/[0.08]">
          {fields.length ? (
            fields.map((field) => <FieldRow key={field.id} crewId={crewId} field={field} />)
          ) : (
            <EmptyState text={t("noCustomFields")} />
          )}
        </div>
      </SettingsPanel>
    </fieldset>
  );
}

function FieldRow({ crewId, field }: { crewId: string; field: CrewTaskFieldDTO }) {
  const t = useTranslations("crewTaskProject");
  const action = useSettingsAction();
  const updateField = useUpdateCrewTaskField(crewId);
  const deleteField = useDeleteCrewTaskField(crewId);
  const [editing, setEditing] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [name, setName] = useState(field.name);
  const [description, setDescription] = useState(field.description);
  const [options, setOptions] = useState(field.options.map((option) => option.label).join(", "));
  const [originalOptions, setOriginalOptions] = useState(options);
  const [required, setRequired] = useState(field.required);
  const supportsOptions = field.type === "single_select" || field.type === "multi_select";

  const [editUpdatedAt, setEditUpdatedAt] = useState(field.updatedAt);
  const startEditing = () => {
    if (action.busy) return;
    setName(field.name);
    setDescription(field.description);
    setOptions(field.options.map((option) => option.label).join(", "));
    setOriginalOptions(field.options.map((option) => option.label).join(", "));
    setRequired(field.required);
    setEditUpdatedAt(field.updatedAt);
    setDeleteArmed(false);
    setEditing(true);
  };

  const save = async () => {
    if (!action.start()) return;
    try {
      const nextLabels = uniqueLabels(options);
      await updateField.mutateAsync({
        fieldId: field.id,
        input: {
          expectedUpdatedAt: editUpdatedAt,
          name: name.trim(),
          description: description.trim(),
          required,
          ...(supportsOptions && options !== originalOptions
            ? {
                options: nextLabels.map((label) => ({
                  id:
                    field.options.find((option) => option.label === label)?.id ??
                    crypto.randomUUID(),
                  label,
                })),
              }
            : {}),
        },
      });
      if (!action.active()) return;
      setEditing(false);
      toast.success(t("customFieldSaved"));
    } catch (error) {
      if (!action.active()) return;
      toast.error(error instanceof Error ? error.message : t("customFieldSaveFailed"));
    } finally {
      action.finish();
    }
  };

  const remove = async () => {
    if (!deleteArmed) return setDeleteArmed(true);
    if (!action.start()) return;
    try {
      await deleteField.mutateAsync(field.id);
      if (!action.active()) return;
      toast.success(t("customFieldDeleted"));
    } catch (error) {
      if (!action.active()) return;
      setDeleteArmed(false);
      toast.error(error instanceof Error ? error.message : t("customFieldDeleteFailed"));
    } finally {
      action.finish();
    }
  };

  return (
    <fieldset disabled={action.busy} className="contents">
      {" "}
      <div className="bg-white/[0.015] p-3">
        {editing ? (
          <div className="space-y-2">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
            <Input value={description} onChange={(event) => setDescription(event.target.value)} />
            {supportsOptions ? (
              <Input value={options} onChange={(event) => setOptions(event.target.value)} />
            ) : null}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-[10px] text-[#858b95]">
                <input
                  type="checkbox"
                  checked={required}
                  onChange={(event) => setRequired(event.target.checked)}
                />
                {t("customFieldRequired")}
              </label>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" color="muted" onClick={() => setEditing(false)}>
                  {t("cancel")}
                </Button>
                <Button
                  size="sm"
                  disabled={!name.trim() || (supportsOptions && uniqueLabels(options).length === 0)}
                  loading={action.busy}
                  onClick={() => void save()}
                >
                  {t("save")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <IconColumns3 className="size-3.5 text-[#717781]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[12px] font-medium">{field.name}</span>
                <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-[#858b95]">
                  {t(`customFieldType.${field.type}`)}
                </span>
                {field.required ? (
                  <span className="text-[9px] text-red-300">{t("required")}</span>
                ) : null}
              </div>
              <p className="mt-1 truncate text-[10px] text-[#777d87]">
                {field.description || t("noCustomFieldDescription")}
              </p>
            </div>
            <IconButton label={t("edit")} onClick={startEditing}>
              <IconPencil />
            </IconButton>
            <IconButton
              label={deleteArmed ? t("confirmDelete") : t("delete")}
              destructive={deleteArmed}
              disabled={action.busy}
              onClick={() => void remove()}
            >
              <IconTrash />
            </IconButton>
          </div>
        )}
      </div>
    </fieldset>
  );
}

function SettingsPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-[14px] font-semibold">{title}</h3>
        <p className="mt-1 text-[11px] leading-5 text-[#777d87]">{description}</p>
      </div>
      {children}
    </section>
  );
}

function SettingsNav({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-[11px] transition-colors",
        active
          ? "bg-white/[0.08] text-[#eceef1]"
          : "text-[#858b95] hover:bg-white/[0.045] hover:text-[#d3d6db]"
      )}
    >
      <span className="[&>svg]:size-3.5">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <span className="font-mono text-[9px] text-[#666c76]">{count}</span>
    </button>
  );
}

function IconButton({
  label,
  destructive = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md text-[#737985] hover:bg-white/[0.055] hover:text-[#e1e3e7] disabled:opacity-40 [&>svg]:size-3.5",
        destructive && "bg-red-500/10 text-red-300 hover:bg-red-500/15 hover:text-red-200"
      )}
    >
      {children}
    </button>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-[10px] text-[#858b95]">
      {label}
      <Input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5"
      />
    </label>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="px-4 py-10 text-center text-[10px] text-[#6f7580]">{text}</p>;
}

function uniqueLabels(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

function toDateInput(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dateStartIso(value: string) {
  return new Date(`${value}T00:00:00`).toISOString();
}

function dateEndIso(value: string) {
  return new Date(`${value}T23:59:59.999`).toISOString();
}
