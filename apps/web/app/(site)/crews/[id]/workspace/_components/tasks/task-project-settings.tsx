"use client";

import { useState } from "react";
import {
  IconCheck,
  IconCircleFilled,
  IconColumns3,
  IconFlag3,
  IconGitBranch,
  IconSettings,
  IconTag,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";

import {
  useCreateCrewTaskField,
  useCreateCrewTaskLabel,
  useDeleteCrewTaskCycle,
  useDeleteCrewTaskField,
  useDeleteCrewTaskLabel,
  useDeleteCrewTaskView,
  useUpdateCrewTaskCycle,
  useUpdateCrewTaskField,
  useUpdateCrewTaskLabel,
  useUpdateCrewTaskView,
  type CrewMemberDTO,
  type CrewTaskCycleDTO,
  type CrewTaskFieldDTO,
  type CrewTaskFieldType,
  type CrewTaskLabelDTO,
  type CrewTaskPriority,
  type CrewTaskProjectDTO,
  type CrewTaskViewDTO,
  type CrewTaskViewGroup,
  type CrewTaskViewLayout,
  type CrewTaskViewScope,
  type CrewTaskWorkflowStateDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
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

interface ViewSettingsDialogProps {
  crewId: string;
  view: CrewTaskViewDTO;
  cycles: CrewTaskCycleDTO[];
  labels: CrewTaskLabelDTO[];
  fields: CrewTaskFieldDTO[];
  workflowStates: CrewTaskProjectDTO["workflowStates"];
  members: CrewMemberDTO[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

export function ViewSettingsDialog({
  crewId,
  view,
  cycles,
  labels,
  fields,
  workflowStates,
  members,
  open,
  onOpenChange,
  onDeleted,
}: ViewSettingsDialogProps) {
  const t = useTranslations("crewTaskProject");
  const updateView = useUpdateCrewTaskView(crewId);
  const deleteView = useDeleteCrewTaskView(crewId);
  const displays = useUserDisplays(members.map((member) => member.userId));
  const [name, setName] = useState(view.name);
  const [layout, setLayout] = useState<CrewTaskViewLayout>(view.layout);
  const [scope, setScope] = useState<CrewTaskViewScope>(view.scope);
  const [groupBy, setGroupBy] = useState<CrewTaskViewGroup>(view.groupBy ?? "none");
  const [sortField, setSortField] = useState<CrewTaskViewDTO["sorts"][number]["field"]>(
    view.sorts[0]?.field ?? "rank"
  );
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(
    view.sorts[0]?.direction ?? "asc"
  );
  const [workflowStateIds, setWorkflowStateIds] = useState<string[]>(
    view.filters.workflowStateIds ?? []
  );
  const [priorities, setPriorities] = useState<CrewTaskPriority[]>(view.filters.priorities ?? []);
  const [cycleIds, setCycleIds] = useState<string[]>(view.filters.cycleIds ?? []);
  const [labelIds, setLabelIds] = useState<string[]>(view.filters.labelIds ?? []);
  const [assigneeUserIds, setAssigneeUserIds] = useState<string[]>(
    view.filters.assigneeUserIds ?? []
  );
  const [unassigned, setUnassigned] = useState(Boolean(view.filters.unassigned));
  const [overdue, setOverdue] = useState(Boolean(view.filters.overdue));
  const [visibleFields, setVisibleFields] = useState<string[]>(
    view.visibleFields.length
      ? view.visibleFields
      : ["status", "priority", "assignees", "estimate", "cycle", "dueAt"]
  );
  const [deleteArmed, setDeleteArmed] = useState(false);

  const save = async () => {
    try {
      await updateView.mutateAsync({
        viewId: view.id,
        input: {
          expectedUpdatedAt: view.updatedAt,
          name,
          layout,
          scope,
          groupBy,
          filters: {
            ...(workflowStateIds.length ? { workflowStateIds } : {}),
            ...(priorities.length ? { priorities } : {}),
            ...(cycleIds.length ? { cycleIds } : {}),
            ...(labelIds.length ? { labelIds } : {}),
            ...(assigneeUserIds.length ? { assigneeUserIds } : {}),
            ...(unassigned ? { unassigned: true } : {}),
            ...(overdue ? { overdue: true } : {}),
          },
          sorts: [{ field: sortField, direction: sortDirection }],
          visibleFields,
        },
      });
      toast.success(t("viewSaved"));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("viewSaveFailed"));
    }
  };

  const remove = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    try {
      await deleteView.mutateAsync(view.id);
      onDeleted();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("viewDeleteFailed"));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setDeleteArmed(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("viewSettings")}</DialogTitle>
          <DialogDescription>{t("viewSettingsDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid max-h-[68vh] gap-6 overflow-y-auto md:grid-cols-[220px_1fr]">
          <div className="space-y-4">
            <FieldLabel label={t("viewName")}>
              <Input
                value={view.isSystem ? t(`views.${view.name}`) : name}
                disabled={view.isSystem}
                onChange={(event) => setName(event.target.value)}
              />
            </FieldLabel>
            <FieldLabel label={t("layoutLabel")}>
              <Select
                value={layout}
                onChange={(value) => setLayout(value as CrewTaskViewLayout)}
                options={(["table", "board", "calendar", "timeline"] as const).map((value) => ({
                  value,
                  label: t(`layout.${value}`),
                }))}
              />
            </FieldLabel>
            <FieldLabel label={t("scope")}>
              <Select
                value={scope}
                onChange={(value) => setScope(value as CrewTaskViewScope)}
                options={(["all", "backlog", "active", "review", "completed"] as const).map(
                  (value) => ({ value, label: t(`scopeValue.${value}`) })
                )}
              />
            </FieldLabel>
            <FieldLabel label={t("groupBy")}>
              <Select
                value={groupBy}
                onChange={(value) => setGroupBy(value as CrewTaskViewGroup)}
                options={(["none", "status", "priority", "assignee", "cycle"] as const).map(
                  (value) => ({ value, label: t(`groupValue.${value}`) })
                )}
              />
            </FieldLabel>
            <FieldLabel label={t("sortBy")}>
              <Select
                value={sortField}
                onChange={(value) =>
                  setSortField(value as CrewTaskViewDTO["sorts"][number]["field"])
                }
                options={(
                  [
                    "rank",
                    "number",
                    "title",
                    "status",
                    "priority",
                    "startAt",
                    "dueAt",
                    "updatedAt",
                  ] as const
                ).map((value) => ({ value, label: t(`sortField.${value}`) }))}
              />
            </FieldLabel>
            <FieldLabel label={t("sortDirection")}>
              <Select
                value={sortDirection}
                onChange={(value) => setSortDirection(value as "asc" | "desc")}
                options={[
                  { value: "asc", label: t("sortDirectionValue.asc") },
                  { value: "desc", label: t("sortDirectionValue.desc") },
                ]}
              />
            </FieldLabel>
          </div>

          <div className="space-y-5">
            {layout === "table" || layout === "board" ? (
              <FilterSection title={t(layout === "board" ? "visibleProperties" : "visibleColumns")}>
                {(
                  [
                    "status",
                    "priority",
                    "assignees",
                    "estimate",
                    "cycle",
                    "labels",
                    "dueAt",
                    "startAt",
                    "points",
                    "updatedAt",
                    "parent",
                    "subtasks",
                    "blockedBy",
                  ] as const
                ).map((field) => (
                  <FilterChip
                    key={field}
                    selected={visibleFields.includes(field)}
                    onClick={() => setVisibleFields(toggleValue(visibleFields, field))}
                  >
                    {t(`field.${field}`)}
                  </FilterChip>
                ))}
                {fields.map((field) => {
                  const key = `custom:${field.id}`;
                  return (
                    <FilterChip
                      key={key}
                      selected={visibleFields.includes(key)}
                      onClick={() => setVisibleFields(toggleValue(visibleFields, key))}
                    >
                      {field.name}
                    </FilterChip>
                  );
                })}
              </FilterSection>
            ) : null}
            <FilterSection title={t("filterStatus")}>
              {workflowStates.map((state) => (
                <FilterChip
                  key={state.id}
                  selected={workflowStateIds.includes(state.id)}
                  onClick={() => setWorkflowStateIds(toggleValue(workflowStateIds, state.id))}
                >
                  <IconCircleFilled className="size-2.5" style={{ color: state.color }} />
                  {state.systemKey ? t(`status.${state.systemKey}`) : state.name}
                </FilterChip>
              ))}
            </FilterSection>
            <FilterSection title={t("filterPriority")}>
              {(["urgent", "high", "normal", "low"] as CrewTaskPriority[]).map((priority) => (
                <FilterChip
                  key={priority}
                  selected={priorities.includes(priority)}
                  onClick={() => setPriorities(toggleValue(priorities, priority))}
                >
                  {t(`priority.${priority}`)}
                </FilterChip>
              ))}
            </FilterSection>
            <FilterSection title={t("filterCycle")}>
              {cycles.length ? (
                cycles.map((cycle) => (
                  <FilterChip
                    key={cycle.id}
                    selected={cycleIds.includes(cycle.id)}
                    onClick={() => setCycleIds(toggleValue(cycleIds, cycle.id))}
                  >
                    {cycle.name}
                  </FilterChip>
                ))
              ) : (
                <EmptyHint>{t("noCycles")}</EmptyHint>
              )}
            </FilterSection>
            <FilterSection title={t("filterLabels")}>
              {labels.length ? (
                labels.map((label) => (
                  <FilterChip
                    key={label.id}
                    selected={labelIds.includes(label.id)}
                    onClick={() => setLabelIds(toggleValue(labelIds, label.id))}
                  >
                    <IconCircleFilled className="size-2.5" style={{ color: label.color }} />
                    {label.name}
                  </FilterChip>
                ))
              ) : (
                <EmptyHint>{t("noLabels")}</EmptyHint>
              )}
            </FilterSection>
            <FilterSection title={t("filterAssignee")}>
              {members.length ? (
                members.map((member) => (
                  <FilterChip
                    key={member.userId}
                    selected={assigneeUserIds.includes(member.userId)}
                    onClick={() => setAssigneeUserIds(toggleValue(assigneeUserIds, member.userId))}
                  >
                    {displayNameOf(member.userId, displays)}
                  </FilterChip>
                ))
              ) : (
                <EmptyHint>{t("noMembers")}</EmptyHint>
              )}
            </FilterSection>
            <div className="flex flex-wrap gap-2">
              <FilterChip selected={unassigned} onClick={() => setUnassigned(!unassigned)}>
                {t("onlyUnassigned")}
              </FilterChip>
              <FilterChip selected={overdue} onClick={() => setOverdue(!overdue)}>
                {t("onlyOverdue")}
              </FilterChip>
            </div>
          </div>
        </DialogBody>
        <DialogFooter className="sm:justify-between">
          <div>
            {!view.isSystem ? (
              <Button
                variant="outline"
                color="destructive"
                loading={deleteView.isPending}
                icon={<IconTrash />}
                onClick={() => void remove()}
              >
                {deleteArmed ? t("confirmDeleteView") : t("deleteView")}
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={!name.trim()}
              loading={updateView.isPending}
              icon={<IconCheck />}
              onClick={() => void save()}
            >
              {t("saveView")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ProjectSettingsDialogProps {
  crewId: string;
  project: CrewTaskProjectDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditWorkflowState: (state: CrewTaskWorkflowStateDTO) => void;
}

export function ProjectSettingsDialog({
  crewId,
  project,
  open,
  onOpenChange,
  onEditWorkflowState,
}: ProjectSettingsDialogProps) {
  const t = useTranslations("crewTaskProject");
  const createLabel = useCreateCrewTaskLabel(crewId);
  const [section, setSection] = useState<"workflow" | "cycles" | "labels" | "fields">("workflow");
  const [labelName, setLabelName] = useState("");
  const [labelDescription, setLabelDescription] = useState("");
  const [labelColor, setLabelColor] = useState("#e12b32");

  const addLabel = async () => {
    try {
      await createLabel.mutateAsync({
        name: labelName,
        color: labelColor,
        description: labelDescription,
      });
      setLabelName("");
      setLabelDescription("");
      toast.success(t("labelCreated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("labelCreateFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("projectSettings")}</DialogTitle>
          <DialogDescription>{t("projectSettingsDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid min-h-[430px] gap-5 md:grid-cols-[170px_1fr]">
          <nav className="space-y-1 border-r border-border pr-4">
            <SettingsNav
              active={section === "workflow"}
              icon={<IconGitBranch />}
              label={t("workflowColumns")}
              count={project.workflowStates.filter((state) => !state.archived).length}
              onClick={() => setSection("workflow")}
            />
            <SettingsNav
              active={section === "cycles"}
              icon={<IconFlag3 />}
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
          {section === "workflow" ? (
            <div className="space-y-2">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-foreground">{t("workflowManagement")}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t("workflowManagementDescription")}
                </p>
              </div>
              <div className="divide-y divide-border rounded-lg border border-border">
                {project.workflowStates.map((state) => (
                  <button
                    key={state.id}
                    type="button"
                    className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/30"
                    onClick={() => onEditWorkflowState(state)}
                  >
                    <IconCircleFilled className="size-3 shrink-0" style={{ color: state.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium text-foreground">
                          {state.systemKey ? t(`status.${state.systemKey}`) : state.name}
                        </span>
                        {state.archived ? (
                          <span className="rounded border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                            {t("workflowArchived")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-[10px] text-muted-foreground">
                        {t(`workflowBehaviorHelp.${state.semantic}`)}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {state.archived ? t("restoreColumn") : t("editColumn")}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] leading-5 text-muted-foreground">
                {t("workflowSettingsHint")}
              </p>
            </div>
          ) : section === "cycles" ? (
            <div className="space-y-2">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-foreground">{t("cycleManagement")}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t("cycleManagementDescription")}
                </p>
              </div>
              {project.cycles.length ? (
                project.cycles.map((cycle) => (
                  <CycleRow key={cycle.id} crewId={crewId} cycle={cycle} />
                ))
              ) : (
                <EmptyPanel icon={<IconFlag3 />} text={t("noCycles")} />
              )}
            </div>
          ) : section === "labels" ? (
            <div>
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-foreground">{t("labelManagement")}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t("labelManagementDescription")}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-[42px_1fr_1.4fr_auto]">
                <input
                  type="color"
                  value={labelColor}
                  onChange={(event) => setLabelColor(event.target.value)}
                  className="h-9 w-10 cursor-pointer rounded border border-border bg-transparent p-1"
                  aria-label={t("labelColor")}
                />
                <Input
                  value={labelName}
                  onChange={(event) => setLabelName(event.target.value)}
                  placeholder={t("labelName")}
                />
                <Input
                  value={labelDescription}
                  onChange={(event) => setLabelDescription(event.target.value)}
                  placeholder={t("labelDescription")}
                />
                <Button
                  disabled={!labelName.trim()}
                  loading={createLabel.isPending}
                  onClick={() => void addLabel()}
                >
                  {t("addLabel")}
                </Button>
              </div>
              <div className="mt-5 divide-y divide-border rounded-lg border border-border">
                {project.labels.length ? (
                  project.labels.map((label) => (
                    <LabelRow key={label.id} crewId={crewId} label={label} />
                  ))
                ) : (
                  <EmptyPanel icon={<IconTag />} text={t("noLabels")} />
                )}
              </div>
            </div>
          ) : (
            <CustomFieldsPanel crewId={crewId} fields={project.fields} />
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {t("done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CycleRow({ crewId, cycle }: { crewId: string; cycle: CrewTaskCycleDTO }) {
  const t = useTranslations("crewTaskProject");
  const updateCycle = useUpdateCrewTaskCycle(crewId);
  const deleteCycle = useDeleteCrewTaskCycle(crewId);
  const [editing, setEditing] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [name, setName] = useState(cycle.name);
  const [goal, setGoal] = useState(cycle.goal);
  const [status, setStatus] = useState(cycle.status);
  const [startAt, setStartAt] = useState(() => toLocalDateInput(cycle.startAt));
  const [endAt, setEndAt] = useState(() => toLocalDateInput(cycle.endAt));

  const reset = () => {
    setName(cycle.name);
    setGoal(cycle.goal);
    setStatus(cycle.status);
    setStartAt(toLocalDateInput(cycle.startAt));
    setEndAt(toLocalDateInput(cycle.endAt));
    setDeleteArmed(false);
  };

  const setCycleStatus = async (nextStatus: CrewTaskCycleDTO["status"]) => {
    try {
      await updateCycle.mutateAsync({
        cycleId: cycle.id,
        input: {
          expectedUpdatedAt: cycle.updatedAt,
          status: nextStatus,
        },
      });
      setStatus(nextStatus);
      toast.success(t("cycleSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("cycleUpdateFailed"));
    }
  };

  const save = async () => {
    try {
      await updateCycle.mutateAsync({
        cycleId: cycle.id,
        input: {
          expectedUpdatedAt: cycle.updatedAt,
          name,
          goal,
          status,
          startAt: new Date(`${startAt}T00:00:00`).toISOString(),
          endAt: new Date(`${endAt}T23:59:59`).toISOString(),
        },
      });
      setEditing(false);
      toast.success(t("cycleSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("cycleUpdateFailed"));
    }
  };

  const remove = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    try {
      await deleteCycle.mutateAsync(cycle.id);
      toast.success(t("cycleDeleted"));
    } catch (error) {
      setDeleteArmed(false);
      toast.error(error instanceof Error ? error.message : t("cycleDeleteFailed"));
    }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/15 p-3">
      {editing ? (
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-[1fr_150px]">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label={t("cycleEditName")}
            />
            <Select
              value={status}
              onChange={(value) => setStatus(value as CrewTaskCycleDTO["status"])}
              options={(["planned", "active", "completed", "cancelled"] as const).map((value) => ({
                value,
                label: t(`cycleStatus.${value}`),
              }))}
            />
          </div>
          <Textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            aria-label={t("cycleEditGoal")}
            className="min-h-20"
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[10px] text-muted-foreground">
              {t("startAt")}
              <Input
                type="date"
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
                className="mt-1.5"
              />
            </label>
            <label className="text-[10px] text-muted-foreground">
              {t("endAt")}
              <Input
                type="date"
                value={endAt}
                onChange={(event) => setEndAt(event.target.value)}
                className="mt-1.5"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              color="muted"
              onClick={() => {
                reset();
                setEditing(false);
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              disabled={!name.trim() || !startAt || !endAt || endAt < startAt}
              loading={updateCycle.isPending}
              onClick={() => void save()}
            >
              {t("save")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-[1fr_150px_auto]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">C{cycle.number}</span>
              <span className="truncate text-xs font-medium text-foreground">{cycle.name}</span>
              <CycleStatus status={cycle.status} />
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
              {cycle.goal || t("noCycleGoal")}
            </p>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {formatDate(cycle.startAt)} — {formatDate(cycle.endAt)}
            </p>
          </div>
          <Select
            value={cycle.status}
            disabled={updateCycle.isPending}
            onChange={(value) => void setCycleStatus(value as CrewTaskCycleDTO["status"])}
            options={(["planned", "active", "completed", "cancelled"] as const).map((value) => ({
              value,
              label: t(`cycleStatus.${value}`),
            }))}
          />
          <div className="flex items-start gap-1">
            <Button
              size="sm"
              variant="ghost"
              color="muted"
              onClick={() => {
                reset();
                setEditing(true);
              }}
            >
              {t("edit")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              color={deleteArmed ? "destructive" : "muted"}
              loading={deleteCycle.isPending}
              onClick={() => void remove()}
            >
              {deleteArmed ? t("confirmDeleteCycle") : t("delete")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LabelRow({ crewId, label }: { crewId: string; label: CrewTaskLabelDTO }) {
  const t = useTranslations("crewTaskProject");
  const updateLabel = useUpdateCrewTaskLabel(crewId);
  const deleteLabel = useDeleteCrewTaskLabel(crewId);
  const [editing, setEditing] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [name, setName] = useState(label.name);
  const [description, setDescription] = useState(label.description);
  const [color, setColor] = useState(label.color);

  const cancel = () => {
    setName(label.name);
    setDescription(label.description);
    setColor(label.color);
    setDeleteArmed(false);
    setEditing(false);
  };

  const save = async () => {
    try {
      await updateLabel.mutateAsync({
        labelId: label.id,
        input: {
          expectedUpdatedAt: label.updatedAt,
          name,
          description,
          color,
        },
      });
      setEditing(false);
      toast.success(t("labelSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("labelSaveFailed"));
    }
  };

  const remove = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    try {
      await deleteLabel.mutateAsync(label.id);
      toast.success(t("labelDeleted"));
    } catch (error) {
      setDeleteArmed(false);
      toast.error(error instanceof Error ? error.message : t("labelDeleteFailed"));
    }
  };

  return (
    <div className="px-3 py-3">
      {editing ? (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-[42px_1fr]">
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="h-9 w-10 cursor-pointer rounded border border-border bg-transparent p-1"
              aria-label={t("labelColor")}
            />
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label={t("labelName")}
            />
          </div>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("labelDescription")}
            aria-label={t("labelDescription")}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" color="muted" onClick={cancel}>
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              disabled={!name.trim()}
              loading={updateLabel.isPending}
              onClick={() => void save()}
            >
              {t("save")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <IconCircleFilled className="size-3 shrink-0" style={{ color: label.color }} />
          <span className="text-xs font-medium text-foreground">{label.name}</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {label.description || t("noLabelDescription")}
          </span>
          <Button
            size="sm"
            variant="ghost"
            color="muted"
            onClick={() => {
              setDeleteArmed(false);
              setEditing(true);
            }}
          >
            {t("edit")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            color={deleteArmed ? "destructive" : "muted"}
            loading={deleteLabel.isPending}
            onClick={() => void remove()}
          >
            {deleteArmed ? t("confirmDelete") : t("delete")}
          </Button>
        </div>
      )}
    </div>
  );
}

function CustomFieldsPanel({ crewId, fields }: { crewId: string; fields: CrewTaskFieldDTO[] }) {
  const t = useTranslations("crewTaskProject");
  const createField = useCreateCrewTaskField(crewId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<CrewTaskFieldType>("text");
  const [optionLabels, setOptionLabels] = useState("");
  const [required, setRequired] = useState(false);
  const supportsOptions = type === "single_select" || type === "multi_select";

  const create = async () => {
    const options = supportsOptions
      ? uniqueOptionLabels(optionLabels).map((label) => ({
          id: crypto.randomUUID(),
          label,
        }))
      : [];
    try {
      await createField.mutateAsync({
        name,
        description,
        type,
        options,
        required,
      });
      setName("");
      setDescription("");
      setOptionLabels("");
      setRequired(false);
      toast.success(t("customFieldCreated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("customFieldCreateFailed"));
    }
  };

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">{t("customFieldManagement")}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {t("customFieldManagementDescription")}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-muted/10 p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("customFieldName")}
          />
          <Select
            value={type}
            onChange={(value) => setType(value as CrewTaskFieldType)}
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
          className="mt-2"
        />
        {supportsOptions ? (
          <Input
            value={optionLabels}
            onChange={(event) => setOptionLabels(event.target.value)}
            placeholder={t("customFieldOptions")}
            className="mt-2"
          />
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
              className="accent-red-500"
            />
            {t("customFieldRequired")}
          </label>
          <Button
            size="sm"
            disabled={!name.trim() || (supportsOptions && !uniqueOptionLabels(optionLabels).length)}
            loading={createField.isPending}
            onClick={() => void create()}
          >
            {t("addCustomField")}
          </Button>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {fields.length ? (
          fields.map((field) => <CustomFieldRow key={field.id} crewId={crewId} field={field} />)
        ) : (
          <EmptyPanel icon={<IconColumns3 />} text={t("noCustomFields")} />
        )}
      </div>
    </div>
  );
}

function CustomFieldRow({ crewId, field }: { crewId: string; field: CrewTaskFieldDTO }) {
  const t = useTranslations("crewTaskProject");
  const updateField = useUpdateCrewTaskField(crewId);
  const deleteField = useDeleteCrewTaskField(crewId);
  const [editing, setEditing] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [name, setName] = useState(field.name);
  const [description, setDescription] = useState(field.description);
  const [required, setRequired] = useState(field.required);
  const [optionLabels, setOptionLabels] = useState(
    field.options.map((option) => option.label).join(", ")
  );
  const supportsOptions = field.type === "single_select" || field.type === "multi_select";

  const save = async () => {
    const labels = uniqueOptionLabels(optionLabels);
    const options = supportsOptions
      ? labels.map((label, index) => ({
          id: field.options[index]?.id ?? crypto.randomUUID(),
          label,
          ...(field.options[index]?.color ? { color: field.options[index].color } : {}),
        }))
      : undefined;
    try {
      await updateField.mutateAsync({
        fieldId: field.id,
        input: {
          expectedUpdatedAt: field.updatedAt,
          name,
          description,
          required,
          ...(options ? { options } : {}),
        },
      });
      setEditing(false);
      toast.success(t("customFieldSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("customFieldSaveFailed"));
    }
  };

  const remove = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    try {
      await deleteField.mutateAsync(field.id);
      toast.success(t("customFieldDeleted"));
    } catch (error) {
      setDeleteArmed(false);
      toast.error(error instanceof Error ? error.message : t("customFieldDeleteFailed"));
    }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/10 p-3">
      {editing ? (
        <>
          <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
            <div className="flex items-center rounded-lg border border-border px-2.5 text-[10px] text-muted-foreground">
              {t(`customFieldType.${field.type}`)}
            </div>
          </div>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("customFieldDescription")}
            className="mt-2"
          />
          {supportsOptions ? (
            <Input
              value={optionLabels}
              onChange={(event) => setOptionLabels(event.target.value)}
              placeholder={t("customFieldOptions")}
              className="mt-2"
            />
          ) : null}
          <div className="mt-3 flex items-center justify-between">
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                checked={required}
                onChange={(event) => setRequired(event.target.checked)}
                className="accent-red-500"
              />
              {t("customFieldRequired")}
            </label>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" color="muted" onClick={() => setEditing(false)}>
                {t("cancel")}
              </Button>
              <Button
                size="sm"
                disabled={
                  !name.trim() || (supportsOptions && !uniqueOptionLabels(optionLabels).length)
                }
                loading={updateField.isPending}
                onClick={() => void save()}
              >
                {t("save")}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-md border border-border bg-background p-1.5 text-muted-foreground">
            <IconColumns3 className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-foreground">{field.name}</span>
              <span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[8px] text-muted-foreground">
                {t(`customFieldType.${field.type}`)}
              </span>
              {field.required ? (
                <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[8px] text-red-300">
                  {t("required")}
                </span>
              ) : null}
            </div>
            <p className="mt-1 truncate text-[10px] text-muted-foreground">
              {field.description ||
                (supportsOptions
                  ? field.options.map((option) => option.label).join(" · ")
                  : t("noCustomFieldDescription"))}
            </p>
          </div>
          <Button size="sm" variant="ghost" color="muted" onClick={() => setEditing(true)}>
            {t("edit")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            color={deleteArmed ? "destructive" : "muted"}
            loading={deleteField.isPending}
            onClick={() => void remove()}
          >
            {deleteArmed ? t("confirmDelete") : t("delete")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ProjectSettingsButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations("crewTaskProject");
  return (
    <Button size="sm" variant="outline" color="muted" icon={<IconSettings />} onClick={onClick}>
      {t("planningSettings")}
    </Button>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[11px] text-muted-foreground">
      {label}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function Select({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-[11px] text-foreground outline-none focus:border-red-500/35 disabled:opacity-50"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function FilterChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] transition-colors",
        selected
          ? "border-red-500/30 bg-red-500/10 text-red-200"
          : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
      )}
    >
      {children}
      {selected ? <IconCheck className="size-3" /> : null}
    </button>
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
        "flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[11px]",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
    >
      <span className="[&>svg]:size-3.5">{icon}</span>
      <span className="flex-1">{label}</span>
      <span className="font-mono text-[9px] opacity-60">{count}</span>
    </button>
  );
}

function CycleStatus({ status }: { status: CrewTaskCycleDTO["status"] }) {
  const t = useTranslations("crewTaskProject");
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[8px] font-medium",
        status === "active" && "bg-blue-500/10 text-blue-300",
        status === "planned" && "bg-white/[0.055] text-muted-foreground",
        status === "completed" && "bg-emerald-500/10 text-emerald-300",
        status === "cancelled" && "bg-red-500/10 text-red-300"
      )}
    >
      {t(`cycleStatus.${status}`)}
    </span>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] text-muted-foreground">{children}</span>;
}

function EmptyPanel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="grid min-h-32 place-items-center text-center text-xs text-muted-foreground">
      <div>
        <span className="mx-auto mb-2 block w-fit [&>svg]:size-5">{icon}</span>
        {text}
      </div>
    </div>
  );
}

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toLocalDateInput(value: string): string {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function uniqueOptionLabels(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean)
    ),
  ];
}
