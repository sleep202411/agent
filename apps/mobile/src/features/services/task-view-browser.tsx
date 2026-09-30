import { TaskViewLifecycle } from "./task-view-lifecycle";
import { TaskViewEditor } from "./task-view-editor";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { fetchTaskViews, type TaskView, type TaskViewQuery } from "./task-view-api";
import { useTaskViewTasks } from "./use-task-view-tasks";
import { taskLabel, type TaskOption } from "./task-options";
type Props = {
  userId: string;
  crewId: string;
  generation: number;
  viewId?: string;
  onViewChange: (id: string) => void;
  onSelect: (task: TaskOption) => void;
  onClose: () => void;
};
export function TaskViewBrowser(props: Props) {
  const active = useScreenActive();
  return active && props.generation === getAuthGeneration() ? (
    <Session key={`${props.crewId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations(),
    [result, setResult] = useState<{ revision: number; views?: TaskView[]; error?: string }>(),
    [revision, setRevision] = useState(0),
    [choosing, setChoosing] = useState(false),
    [editing, setEditing] = useState(false),
    [lifecycle, setLifecycle] = useState<"create" | "remove">();
  useEffect(() => {
    const c = new AbortController();
    void fetchTaskViews(props.crewId, c.signal).then(
      (v) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setResult({ revision, views: v });
      },
      (e) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setResult({ revision, error: e instanceof Error ? e.message : String(e) });
      }
    );
    return () => c.abort();
  }, [props.crewId, props.generation, revision]);
  const views = result?.revision === revision ? result.views : undefined;
  const error = result?.revision === revision ? result.error : undefined;
  const active = views?.find((v) => v.id === props.viewId) ?? views?.[0];
  if (lifecycle && active)
    return (
      <TaskViewLifecycle
        crewId={props.crewId}
        userId={props.userId}
        generation={props.generation}
        viewId={active.id}
        action={lifecycle}
        onClose={() => {
          setLifecycle(undefined);
          setRevision((v) => v + 1);
        }}
        onChanged={(id) => {
          props.onViewChange(id);
          setLifecycle(undefined);
          setRevision((v) => v + 1);
        }}
      />
    );
  if (editing && active)
    return (
      <TaskViewEditor
        crewId={props.crewId}
        userId={props.userId}
        generation={props.generation}
        viewId={active.id}
        onClose={() => {
          setEditing(false);
          setRevision((v) => v + 1);
        }}
        onSaved={() => {
          setEditing(false);
          setRevision((v) => v + 1);
        }}
      />
    );
  return (
    <View style={{ flex: 1, padding: 12, gap: 10 }}>
      <ThemedText>{t("crewTasks.title")}</ThemedText>
      {!views && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {active && (
        <>
          <Pressable accessibilityRole="button" onPress={() => setChoosing(!choosing)}>
            <ThemedText>
              {t("taskViews.view")} · {active.name}
            </ThemedText>
          </Pressable>
          {choosing &&
            views?.map((v) => (
              <Pressable
                key={v.id}
                accessibilityRole="button"
                accessibilityState={{ selected: v.id === active.id }}
                onPress={() => {
                  if (props.generation === getAuthGeneration()) {
                    props.onViewChange(v.id);
                    setChoosing(false);
                  }
                }}
              >
                <ThemedText>{v.name}</ThemedText>
              </Pressable>
            ))}
          <Pressable accessibilityRole="button" onPress={() => setEditing(true)}>
            <ThemedText>{t("viewEdit.title")}</ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setLifecycle("create")}>
            <ThemedText>{t("viewLifecycle.create")}</ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setLifecycle("remove")}>
            <ThemedText>{t("viewLifecycle.remove")}</ThemedText>
          </Pressable>
          <Rows key={`${active.id}:${revision}`} {...props} view={active} />
        </>
      )}
      {views?.length === 0 && <ThemedText>{t("taskViews.empty")}</ThemedText>}
      <Pressable accessibilityRole="button" onPress={() => setRevision((v) => v + 1)}>
        <ThemedText>{t("thread.refresh")}</ThemedText>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={props.onClose}>
        <ThemedText>{t("report.close")}</ThemedText>
      </Pressable>
    </View>
  );
}
function Rows(props: Props & { view: TaskView }) {
  const t = useTranslations(),
    theme = useTheme();
  const [draft, setDraft] = useState(""),
    [search, setSearch] = useState(""),
    [priority, setPriority] = useState<TaskViewQuery["priority"]>(),
    [selecting, setSelecting] = useState(false);
  const selected = useRef(false);
  const tasks = useTaskViewTasks(String(props.generation), props.crewId, {
    viewId: props.view.id,
    query: search,
    ...(priority ? { priority } : {}),
  });
  return (
    <View style={{ flex: 1, gap: 10 }}>
      <ThemedText>
        {t(`taskViews.${props.view.completedMode}`)} ·{" "}
        {t(props.view.showSubIssues ? "taskViews.subtasks" : "taskViews.topLevel")}
      </ThemedText>
      <TextInput
        accessibilityLabel={t("thread.searchTasks")}
        value={draft}
        onChangeText={setDraft}
        maxLength={180}
        onSubmitEditing={() => setSearch(draft.trim())}
        style={{ color: theme.text, padding: 12 }}
      />
      <Pressable accessibilityRole="button" onPress={() => setSearch(draft.trim())}>
        <ThemedText>{t("crewAssets.search")}</ThemedText>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => setSelecting(!selecting)}>
        <ThemedText>
          {t("taskViews.priority")} ·{" "}
          {priority ? t(`taskSchedule.${priority}`) : t("taskViews.anyPriority")}
        </ThemedText>
      </Pressable>
      {selecting &&
        ([undefined, "low", "normal", "high", "urgent"] as const).map((p) => (
          <Pressable
            key={p ?? "all"}
            accessibilityRole="button"
            accessibilityState={{ selected: priority === p }}
            onPress={() => {
              setPriority(p);
              setSelecting(false);
            }}
          >
            <ThemedText>{p ? t(`taskSchedule.${p}`) : t("taskViews.anyPriority")}</ThemedText>
          </Pressable>
        ))}
      <FlatList
        data={tasks.items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            disabled={selected.current}
            onPress={() => {
              if (!selected.current && props.generation === getAuthGeneration()) {
                selected.current = true;
                props.onSelect(item);
              }
            }}
            style={{ padding: 12 }}
          >
            <ThemedText>{taskLabel(item)}</ThemedText>
          </Pressable>
        )}
        ListEmptyComponent={
          !tasks.loading && !tasks.error ? <ThemedText>{t("thread.noTasks")}</ThemedText> : null
        }
      />
      {tasks.loading && <ActivityIndicator />}
      {tasks.error && (
        <>
          <ThemedText accessibilityRole="alert">{tasks.error}</ThemedText>
          <Pressable accessibilityRole="button" onPress={tasks.retry}>
            <ThemedText>{t("inbox.retry")}</ThemedText>
          </Pressable>
        </>
      )}
      {tasks.hasMore && !tasks.error && (
        <Pressable accessibilityRole="button" disabled={tasks.loading} onPress={tasks.loadMore}>
          <ThemedText>{t("discovery.more")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}
