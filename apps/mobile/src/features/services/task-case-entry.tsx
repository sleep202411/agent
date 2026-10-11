import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { useTaskCenter } from "./use-task-center";
import { TaskCaseCreate } from "./task-case-create";
import type { CenterTask, CenterFilters } from "./task-center-api";
export function TaskCaseEntry({ userId, generation }: { userId: string; generation: number }) {
  const t = useTranslations(),
    theme = useTheme(),
    active = useScreenActive();
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [scope, setScope] = useState<"mine" | "managed">("mine"),
    [selected, setSelected] = useState<CenterTask>();
  const filters = useMemo<CenterFilters>(
    () => ({ scope, status: "all", crewId: "", taskKind: "", query }),
    [scope, query]
  );
  const list = useTaskCenter(active, generation, filters);
  return (
    <View style={{ gap: 12 }}>
      <ThemedText>{t("crewCases.selectTaskHint")}</ThemedText>
      <TextInput
        accessibilityLabel={t("crewCases.recordSearch")}
        placeholder={t("crewCases.recordSearchHint")}
        placeholderTextColor={theme.textSecondary}
        maxLength={180}
        value={search}
        onChangeText={setSearch}
        style={{ padding: 12, color: theme.text, borderWidth: 1, borderColor: theme.border }}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setSelected(undefined);
          setQuery(search.trim());
        }}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("crewCases.searchRecords")}</ThemedText>
      </Pressable>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(["mine", "managed"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ checked: scope === value }}
            onPress={() => {
              setSelected(undefined);
              setScope(value);
            }}
            style={{ padding: 12 }}
          >
            <ThemedText>
              {scope === value ? "● " : "○ "}
              {t(value === "mine" ? "crewCases.mine" : "crewCases.producer")}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      {list.loading && <ActivityIndicator />}
      {list.error ? (
        <>
          <ThemedText accessibilityRole="alert">{list.error}</ThemedText>
          <Pressable accessibilityRole="button" onPress={list.retry} style={{ padding: 12 }}>
            <ThemedText>{t("common.retry")}</ThemedText>
          </Pressable>
        </>
      ) : (
        <>
          {list.items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected?.id === item.id }}
              onPress={() => setSelected(item)}
              style={{ padding: 12 }}
            >
              <ThemedText>
                {selected?.id === item.id ? "● " : "○ "}
                {item.crew.name} · {item.title}
              </ThemedText>
            </Pressable>
          ))}
          {!list.loading && !list.items.length && (
            <ThemedText>{t("crewCases.noMatchingTasks")}</ThemedText>
          )}
          {list.hasMore && (
            <Pressable
              accessibilityRole="button"
              disabled={list.loading}
              onPress={list.loadMore}
              style={{ padding: 12 }}
            >
              <ThemedText>{t("crewCases.moreTasks")}</ThemedText>
            </Pressable>
          )}
          {selected && active && (
            <TaskCaseCreate
              key={selected.id}
              taskId={selected.id}
              crewId={selected.crew.id}
              userId={userId}
              generation={generation}
              initiallyOpen
            />
          )}
        </>
      )}
    </View>
  );
}
