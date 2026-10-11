import { useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTranslations } from "@/i18n";
import { useTaskOptions } from "./use-task-options";
import { taskLabel, type TaskOption } from "./task-options";
export function TaskPicker({
  crewId,
  generation,
  onSelect,
  onClose,
  title,
  closeLabel,
  excludedIds = [],
  recruitmentOnly = false,
}: {
  crewId: string;
  generation: number;
  onSelect: (task: TaskOption) => void;
  onClose: () => void;
  title?: string;
  closeLabel?: string;
  excludedIds?: string[];
  recruitmentOnly?: boolean;
}) {
  const selected = useRef(false);
  const active = useScreenActive(),
    t = useTranslations(),
    theme = useTheme();
  const [draft, setDraft] = useState(""),
    [search, setSearch] = useState("");
  const tasks = useTaskOptions(
    active && generation === getAuthGeneration() ? String(generation) : undefined,
    crewId,
    { query: search, ...(recruitmentOnly ? { recruitmentOnly: true } : {}) }
  );
  return (
    <View style={{ flex: 1, padding: 12, gap: 10 }}>
      <ThemedText>{title ?? t("thread.tagTask")}</ThemedText>
      <TextInput
        accessibilityLabel={t("thread.searchTasks")}
        placeholder={t("thread.searchTasks")}
        placeholderTextColor={theme.textSecondary}
        value={draft}
        onChangeText={setDraft}
        maxLength={180}
        style={{ color: theme.text, padding: 12 }}
        onSubmitEditing={() => setSearch(draft.trim())}
      />
      <Pressable accessibilityRole="button" onPress={() => setSearch(draft.trim())}>
        <ThemedText>{t("crewAssets.search")}</ThemedText>
      </Pressable>
      <FlatList
        data={tasks.items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            disabled={excludedIds.includes(item.id)}
            accessibilityState={{ disabled: excludedIds.includes(item.id) }}
            onPress={() => {
              if (
                active &&
                generation === getAuthGeneration() &&
                !selected.current &&
                !excludedIds.includes(item.id)
              ) {
                selected.current = true;
                onSelect(item);
              }
            }}
            style={{ padding: 12, opacity: excludedIds.includes(item.id) ? 0.45 : 1 }}
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
          <Pressable onPress={tasks.retry}>
            <ThemedText>{t("inbox.retry")}</ThemedText>
          </Pressable>
        </>
      )}
      {tasks.hasMore && !tasks.error && (
        <Pressable disabled={tasks.loading} onPress={tasks.loadMore}>
          <ThemedText>{t("discovery.more")}</ThemedText>
        </Pressable>
      )}
      <Pressable accessibilityRole="button" onPress={onClose}>
        <ThemedText>{closeLabel ?? t("thread.backToChat")}</ThemedText>
      </Pressable>
    </View>
  );
}
