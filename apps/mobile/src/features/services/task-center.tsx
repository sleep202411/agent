import { taskWorkflowLabel } from "./task-workflow-label";
import { useState } from "react";
import { useIsFocused } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations, type MessageKey } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { AuthedWebView } from "@/components/authed-web-view";
import { TaskDetail } from "./task-detail";
import { TaskDeadline } from "./task-deadline";
import { useTaskUnread } from "./use-task-unread";
import { useTaskCenter } from "./use-task-center";
import type { CenterFilters, CenterTask } from "./task-center-api";
export function TaskCenter({ userId, generation }: { userId: string; generation: number }) {
  const active = useScreenActive();
  const focused = useIsFocused();
  const [selected, select] = useState<CenterTask>();
  const [webTask, setWebTask] = useState<string>();
  const t = useTranslations();
  if (!focused || generation !== getAuthGeneration()) return null;
  const detail =
    selected && webTask ? (
      <View style={{ flex: 1 }}>
        <Pressable
          accessibilityRole="button"
          style={{ padding: 12 }}
          onPress={() => setWebTask(undefined)}
        >
          <ThemedText>{t("taskRelations.backToTask")}</ThemedText>
        </Pressable>
        <AuthedWebView
          path={`/crews/${encodeURIComponent(selected.crew.id)}/workspace?tab=tasks&task=${encodeURIComponent(webTask)}`}
          title={t("crewTaskCenter.title")}
        />
      </View>
    ) : selected ? (
      <TaskDetail
        crewId={selected.crew.id}
        taskId={selected.id}
        userId={userId}
        generation={generation}
        onClose={() => select(undefined)}
        onOpenWeb={setWebTask}
      />
    ) : null;
  return (
    <View style={{ flex: 1, display: active ? "flex" : "none" }}>
      <View style={{ flex: 1, display: selected ? "none" : "flex" }}>
        <TaskCenterList generation={generation} onSelect={select} enabled={!selected} />
      </View>
      {detail}
    </View>
  );
}

export function TaskCenterList({
  generation,
  onSelect,
  enabled = true,
}: {
  generation: number;
  enabled?: boolean;
  onSelect: (task: CenterTask) => void;
}) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const [filters, setFilters] = useState<CenterFilters>({
    scope: "mine",
    status: "active",
    crewId: "",
    taskKind: "",
    query: "",
  });
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [warningHours, setWarningHours] = useState(48);
  const active = useScreenActive();
  const list = useTaskCenter(active && enabled, generation, filters);
  const unread = useTaskUnread(active && enabled, generation);
  const label = (key: string) => t(`crewTaskCenter.${key}` as MessageKey);
  const box = { padding: 12, borderRadius: 8, backgroundColor: theme.backgroundElement };
  const update = (next: Partial<CenterFilters>) => {
    if (generation === getAuthGeneration()) setFilters((current) => ({ ...current, ...next }));
  };
  const choice = (key: string, title: string, selected: boolean, press: () => void) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={press}
      style={{ ...box, borderWidth: 1, borderColor: selected ? theme.text : theme.border }}
    >
      <ThemedText type="small">{title}</ThemedText>
    </Pressable>
  );
  return (
    <FlatList
      data={list.items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
      refreshing={list.loading}
      onRefresh={() => {
        list.refresh();
        unread.refresh();
      }}
      onEndReached={list.loadMore}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <ThemedText type="small">{label("description")}</ThemedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {(["mine", "managed", "all"] as const).map((scope) =>
              choice(
                scope,
                label(scope === "managed" ? "producer" : scope === "all" ? "allTasks" : "mine"),
                filters.scope === scope,
                () => update({ scope, crewId: "", taskKind: "" })
              )
            )}
          </View>
          <TextInput
            accessibilityLabel={label("search")}
            placeholder={label("search")}
            placeholderTextColor={theme.textSecondary}
            style={{ ...box, color: theme.text }}
            value={search}
            maxLength={180}
            onChangeText={setSearch}
            onSubmitEditing={() => update({ query: search.trim(), taskKind: "" })}
            returnKeyType="search"
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => update({ query: search.trim(), taskKind: "" })}
          >
            <ThemedText>{label("search")}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: filtersOpen }}
            onPress={() => setFiltersOpen(!filtersOpen)}
          >
            <ThemedText>{label("filters")}</ThemedText>
          </Pressable>
          {filtersOpen && (
            <View style={{ gap: 8 }}>
              <ThemedText type="smallBold">{label("status")}</ThemedText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {(
                  [
                    "active",
                    "submitted",
                    "revision_requested",
                    "overdue",
                    "approved",
                    "all",
                  ] as const
                ).map((status) =>
                  choice(status, label(`filter_${status}`), filters.status === status, () =>
                    update({ status })
                  )
                )}
              </View>
              <ThemedText type="smallBold">{label("crewFilter")}</ThemedText>
              {choice("all-crews", label("allCrews"), !filters.crewId, () =>
                update({ crewId: "", taskKind: "" })
              )}
              {list.summary?.crews.map((crew) =>
                choice(crew.id, crew.name, filters.crewId === crew.id, () =>
                  update({ crewId: crew.id, taskKind: "" })
                )
              )}
              <ThemedText type="smallBold">{label("categoryFilter")}</ThemedText>
              {choice("all-kinds", label("allCategories"), !filters.taskKind, () =>
                update({ taskKind: "" })
              )}
              {list.summary?.categories.map((taskKind) =>
                choice(
                  taskKind,
                  t(`taskKind.${taskKind}` as MessageKey),
                  filters.taskKind === taskKind,
                  () => update({ taskKind })
                )
              )}
              <ThemedText type="small">{t("crewDeadline.warningWindow")}</ThemedText>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {[24, 48, 72].map((hours) =>
                  choice(
                    String(hours),
                    t("crewDeadline.hours").replace("{count}", String(hours)),
                    warningHours === hours,
                    () => setWarningHours(hours)
                  )
                )}
              </View>
            </View>
          )}
          {list.summary && !list.error && (
            <ThemedText type="small">
              {label("dueSoon")}: {list.summary.stats.dueSoon} · {label("pendingReviews")}:{" "}
              {list.summary.stats.pendingReviews}
            </ThemedText>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          disabled={!!list.error}
          style={{ ...box, gap: 6 }}
          onPress={() => {
            if (generation === getAuthGeneration()) onSelect(item);
          }}
        >
          <ThemedText type="small">
            {item.crew.name} · #{item.number}
          </ThemedText>
          <ThemedText type="smallBold">{item.title}</ThemedText>
          {!list.error && unread.counts[item.id] > 0 && (
            <ThemedText type="small" accessibilityLiveRegion="polite">
              {label("unreadNotifications").replace("{count}", String(unread.counts[item.id]))}
            </ThemedText>
          )}
          <ThemedText type="small">
            {taskWorkflowLabel(item.workflowState, t)} ·{" "}
            {t(`taskSchedule.${item.priority}` as MessageKey)}
          </ThemedText>
          {item.dueAt && (
            <ThemedText type="small">{new Date(item.dueAt).toLocaleString(locale)}</ThemedText>
          )}
          <TaskDeadline dueAt={item.dueAt} status={item.status} warningHours={warningHours} />
          <ThemedText type="small">
            {[
              item.canSubmit && label("submit"),
              item.canReview && label("review"),
              label("history"),
            ]
              .filter(Boolean)
              .join(" · ")}
          </ThemedText>
        </Pressable>
      )}
      ListEmptyComponent={
        !list.loading && !list.error ? <ThemedText>{label("empty")}</ThemedText> : null
      }
      ListFooterComponent={
        <View style={{ gap: 12 }}>
          {list.loading && <ActivityIndicator />}
          {unread.error && (
            <View style={{ gap: 8 }}>
              <ThemedText accessibilityRole="alert">{unread.error}</ThemedText>
              <Pressable accessibilityRole="button" onPress={unread.refresh}>
                <ThemedText>{label("retry")}</ThemedText>
              </Pressable>
            </View>
          )}
          {list.error && (
            <>
              <ThemedText accessibilityRole="alert">{list.error}</ThemedText>
              <Pressable accessibilityRole="button" onPress={list.retry}>
                <ThemedText>{label("retry")}</ThemedText>
              </Pressable>
            </>
          )}
          {list.hasMore && !list.loading && !list.error && (
            <Pressable accessibilityRole="button" onPress={list.loadMore}>
              <ThemedText>{label("loadMore")}</ThemedText>
            </Pressable>
          )}
        </View>
      }
    />
  );
}
