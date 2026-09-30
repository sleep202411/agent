import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { TaskMentionPicker } from "./task-mention-picker";
import { useUserDisplays } from "./user-displays";
import {
  changedViewSettings,
  fetchViewEditProject,
  saveTaskView,
  settingsOf,
  sortFields,
  viewFields,
  viewSettings,
  type EditableView,
  type ViewEditProject,
  type ViewSettings,
} from "./task-view-edit-api";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  viewId: string;
  onClose: () => void;
  onSaved: () => void;
};
export function TaskViewEditor(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session
      key={`${props.crewId}:${props.userId}:${props.generation}:${props.viewId}`}
      {...props}
    />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    revision: number;
    project?: ViewEditProject;
    error?: string;
  }>();
  useEffect(() => {
    const c = new AbortController();
    const current = () => !c.signal.aborted && props.generation === getAuthGeneration();
    void (async () => {
      const access = await fetchTaskCommentAccess(props.crewId, props.userId, c.signal);
      if (!current()) return;
      if (!access.canManage) throw new Error(t("taskCreate.managerOnly"));
      const project = await fetchViewEditProject(props.crewId, c.signal);
      if (!project.views.some((v) => v.id === props.viewId)) throw new Error(t("viewEdit.missing"));
      if (current()) setResult({ revision, project });
    })().catch((e) => {
      if (current()) setResult({ revision, error: e instanceof Error ? e.message : String(e) });
    });
    return () => c.abort();
  }, [props.crewId, props.userId, props.generation, props.viewId, revision, t]);
  const visible = result?.revision === revision ? result : undefined;
  if (visible?.project)
    return (
      <Editor
        key={revision}
        {...props}
        project={visible.project}
        view={visible.project.views.find((v) => v.id === props.viewId)!}
        onReload={() => setRevision((v) => v + 1)}
      />
    );
  return (
    <View style={{ padding: 16, gap: 12 }}>
      {!visible?.error && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      <Button label={t("thread.refresh")} onPress={() => setRevision((v) => v + 1)} />
      <Button label={t("crewTasks.back")} onPress={props.onClose} />
    </View>
  );
}
function Editor(
  props: Props & { project: ViewEditProject; view: EditableView; onReload: () => void }
) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.view.id, true);
  const [draft, setDraft] = useState<ViewSettings>(() => settingsOf(props.view));
  const [error, setError] = useState<string>(),
    [attempted, setAttempted] = useState(false),
    [members, setMembers] = useState(false);
  const locked = op.busy || attempted;
  const users = useUserDisplays(String(props.generation), draft.filters.assigneeUserIds ?? []);
  const parsed = viewSettings.safeParse(draft);
  const changed =
    parsed.success && Object.keys(changedViewSettings(props.view, parsed.data)).length > 0;
  const set = <K extends keyof ViewSettings>(key: K, value: ViewSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const filter = <K extends keyof ViewSettings["filters"]>(
    key: K,
    value: ViewSettings["filters"][K]
  ) => setDraft((d) => ({ ...d, filters: { ...d.filters, [key]: value } }));
  const label = (key: (typeof viewFields)[number] | (typeof sortFields)[number]) =>
    t(`viewEdit.field.${key}`);
  if (members && !locked)
    return (
      <TaskMentionPicker
        crewId={props.crewId}
        userId={props.userId}
        generation={props.generation}
        includeSelf
        excludedIds={draft.filters.assigneeUserIds ?? []}
        onClose={() => setMembers(false)}
        onSelect={(member) => {
          filter("assigneeUserIds", [...(draft.filters.assigneeUserIds ?? []), member.userId]);
          setMembers(false);
        }}
      />
    );
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">{t("viewEdit.title")}</ThemedText>
      <ThemedText>{t("viewEdit.shared")}</ThemedText>
      <ThemedText>{t("viewEdit.name")}</ThemedText>
      <TextInput
        accessibilityLabel={t("viewEdit.name")}
        value={draft.name}
        onChangeText={(v) => set("name", v)}
        maxLength={80}
        editable={!locked}
        style={{ color: theme.text, padding: 12 }}
      />
      <Choice
        label={t("viewEdit.completed")}
        values={["all", "recent", "hidden"]}
        selected={draft.completedMode}
        disabled={locked}
        display={(v) => t(`taskViews.${v}`)}
        onChange={(v) => set("completedMode", v)}
      />
      <Toggle
        label={t("taskViews.subtasks")}
        checked={draft.showSubIssues}
        disabled={locked}
        onChange={(v) => set("showSubIssues", v)}
      />
      <ThemedText type="smallBold">{t("viewEdit.filters")}</ThemedText>
      <Checklist
        label={t("viewEdit.field.status")}
        selected={draft.filters.workflowStateIds ?? []}
        options={props.project.workflowStates}
        disabled={locked}
        max={24}
        onChange={(v) => filter("workflowStateIds", v)}
      />
      <Checklist
        label={t("viewEdit.field.priority")}
        selected={draft.filters.priorities ?? []}
        options={(["low", "normal", "high", "urgent"] as const).map((id) => ({
          id,
          name: t(`taskSchedule.${id}`),
        }))}
        disabled={locked}
        max={4}
        onChange={(v) =>
          filter("priorities", v as NonNullable<ViewSettings["filters"]["priorities"]>)
        }
      />
      <Checklist
        label={t("viewEdit.field.cycle")}
        selected={draft.filters.cycleIds ?? []}
        options={props.project.cycles}
        disabled={locked}
        max={50}
        onChange={(v) => filter("cycleIds", v)}
      />
      <Checklist
        label={t("viewEdit.field.labels")}
        selected={draft.filters.labelIds ?? []}
        options={props.project.labels}
        disabled={locked}
        max={50}
        onChange={(v) => filter("labelIds", v)}
      />
      <ThemedText>{t("viewEdit.field.assignees")}</ThemedText>
      {(draft.filters.assigneeUserIds ?? []).map((id) => (
        <Button
          key={id}
          disabled={locked}
          label={`${t("viewEdit.remove")} · ${users?.get(id)?.nickname ?? id}`}
          onPress={() =>
            filter(
              "assigneeUserIds",
              draft.filters.assigneeUserIds?.filter((v) => v !== id)
            )
          }
        />
      ))}
      <Button
        label={t("viewEdit.addMember")}
        disabled={locked || (draft.filters.assigneeUserIds?.length ?? 0) >= 50}
        onPress={() => setMembers(true)}
      />
      <Toggle
        label={t("viewEdit.unassigned")}
        checked={!!draft.filters.unassigned}
        disabled={locked}
        onChange={(v) => filter("unassigned", v)}
      />
      <Toggle
        label={t("viewEdit.overdue")}
        checked={!!draft.filters.overdue}
        disabled={locked}
        onChange={(v) => filter("overdue", v)}
      />
      <Button
        label={t("viewEdit.clearFilters")}
        disabled={locked}
        onPress={() => set("filters", {})}
      />
      <ThemedText type="smallBold">{t("viewEdit.sorts")}</ThemedText>
      {draft.sorts.map((sort, index) => (
        <View key={index} style={{ gap: 8 }}>
          <Choice
            label={`${t("viewEdit.sorts")} ${index + 1}`}
            values={[...sortFields]}
            selected={sort.field}
            disabled={locked}
            display={label}
            onChange={(field) =>
              set(
                "sorts",
                draft.sorts.map((s, i) => (i === index ? { ...s, field } : s))
              )
            }
          />
          <Choice
            label={t("viewEdit.direction")}
            values={["asc", "desc"]}
            selected={sort.direction}
            disabled={locked}
            display={(v) => t(`viewEdit.${v}`)}
            onChange={(direction) =>
              set(
                "sorts",
                draft.sorts.map((s, i) => (i === index ? { ...s, direction } : s))
              )
            }
          />
          <Button
            label={t("viewEdit.remove")}
            disabled={locked}
            onPress={() =>
              set(
                "sorts",
                draft.sorts.filter((_, i) => i !== index)
              )
            }
          />
          {index > 0 && (
            <Button
              label={t("viewEdit.moveUp")}
              disabled={locked}
              onPress={() => {
                const sorts = [...draft.sorts];
                [sorts[index - 1], sorts[index]] = [sorts[index]!, sorts[index - 1]!];
                set("sorts", sorts);
              }}
            />
          )}
        </View>
      ))}
      <Button
        label={t("viewEdit.addSort")}
        disabled={locked || draft.sorts.length >= 3}
        onPress={() => set("sorts", [...draft.sorts, { field: "rank", direction: "asc" }])}
      />
      <ThemedText type="smallBold">{t("viewEdit.display")}</ThemedText>
      <ThemedText>{t("viewEdit.webDisplay")}</ThemedText>
      <Choice
        label={t("viewEdit.layout")}
        values={["list", "board"]}
        selected={draft.layout}
        disabled={locked}
        display={(v) => t(`viewEdit.${v}`)}
        onChange={(v) => set("layout", v)}
      />
      <Choice
        label={t("viewEdit.group")}
        values={["none", "status", "priority", "assignee", "cycle"]}
        selected={draft.groupBy}
        disabled={locked}
        display={(v) => t(`viewEdit.group.${v}`)}
        onChange={(v) => set("groupBy", v)}
      />
      <Toggle
        label={t("viewEdit.emptyGroups")}
        checked={draft.showEmptyGroups}
        disabled={locked}
        onChange={(v) => set("showEmptyGroups", v)}
      />
      <Checklist
        label={t("viewEdit.fields")}
        selected={draft.visibleFields}
        options={[
          ...viewFields.map((id) => ({ id, name: label(id) })),
          ...props.project.fields.map((f) => ({ id: `custom:${f.id}`, name: f.name })),
        ]}
        disabled={locked}
        max={30}
        onChange={(v) => set("visibleFields", v)}
      />
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && error && (
        <>
          <ThemedText>{t("viewEdit.reloadHelp")}</ThemedText>
          <Button label={t("thread.refresh")} disabled={op.busy} onPress={props.onReload} />
        </>
      )}
      <Button
        label={t("viewEdit.save")}
        disabled={locked || !changed}
        onPress={() => {
          if (!parsed.success || !changed || locked) return;
          void op.run(
            () => {
              setAttempted(true);
              return saveTaskView(props.view, parsed.data, props.userId, props.generation);
            },
            props.onSaved,
            (e) => setError(e instanceof Error ? e.message : String(e))
          );
        }}
      />
      {op.busy && <ActivityIndicator />}
      <Button label={t("crewTasks.back")} disabled={op.busy} onPress={props.onClose} />
    </ScrollView>
  );
}
function Button({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={{
        padding: 12,
        backgroundColor: checked ? theme.backgroundSelected : theme.backgroundElement,
      }}
    >
      <ThemedText>
        {checked ? "✓ " : "○ "}
        {label}
      </ThemedText>
    </Pressable>
  );
}
function Choice<T extends string>({
  label,
  values,
  selected,
  disabled,
  display,
  onChange,
}: {
  label: string;
  values: T[];
  selected: T;
  disabled: boolean;
  display: (v: T) => string;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Button
        label={`${label} · ${display(selected)}`}
        disabled={disabled}
        onPress={() => setOpen(!open)}
      />
      {open &&
        values.map((v) => (
          <Button
            key={v}
            label={display(v)}
            disabled={disabled}
            onPress={() => {
              onChange(v);
              setOpen(false);
            }}
          />
        ))}
    </View>
  );
}
function Checklist({
  label,
  options,
  selected,
  max,
  disabled,
  onChange,
}: {
  label: string;
  options: { id: string; name: string }[];
  selected: string[];
  max: number;
  disabled: boolean;
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const all = [
    ...options,
    ...selected.filter((id) => !options.some((o) => o.id === id)).map((id) => ({ id, name: id })),
  ];
  return (
    <View style={{ gap: 6 }}>
      <Button
        label={`${label} · ${selected.length}`}
        disabled={disabled}
        onPress={() => setOpen(!open)}
      />
      {open &&
        all.map((option) => (
          <Toggle
            key={option.id}
            label={option.name}
            checked={selected.includes(option.id)}
            disabled={disabled || (!selected.includes(option.id) && selected.length >= max)}
            onChange={(checked) =>
              onChange(
                checked ? [...selected, option.id] : selected.filter((id) => id !== option.id)
              )
            }
          />
        ))}
    </View>
  );
}
