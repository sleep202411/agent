import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  fetchTaskPlanningOptions,
  type PlanningKind,
  type PlanningOption,
} from "./task-planning-api";
export type TaskPlanningDraft = {
  labels: PlanningOption[];
  cycle: PlanningOption | null;
  episode: PlanningOption | null;
};
export function TaskPlanningFields({
  crewId,
  generation,
  value,
  onChange,
  locked,
}: {
  crewId: string;
  generation: number;
  value: TaskPlanningDraft;
  onChange: Dispatch<SetStateAction<TaskPlanningDraft>>;
  locked: boolean;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [kind, setKind] = useState<PlanningKind>();
  const current = () => !locked && generation === getAuthGeneration();
  return (
    <View style={{ gap: 8 }}>
      {(["cycle", "episode", "labels"] as const).map((key) => (
        <View key={key} style={{ gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            disabled={locked || (key === "labels" && value.labels.length >= 20)}
            style={{ padding: 12 }}
            onPress={() => {
              if (current()) setKind(key);
            }}
          >
            <ThemedText>
              {t(`taskPlanning.${key}`)}
              {key === "labels"
                ? ` · ${value.labels.length}/20`
                : value[key]
                  ? ` · ${value[key].name}`
                  : ""}
            </ThemedText>
          </Pressable>
          {key === "labels"
            ? value.labels.map((label) => (
                <Pressable
                  key={label.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${t("taskPlanning.remove")} ${label.name}`}
                  disabled={locked}
                  style={{ padding: 12 }}
                  onPress={() => {
                    if (current())
                      onChange((old) => ({
                        ...old,
                        labels: old.labels.filter((item) => item.id !== label.id),
                      }));
                  }}
                >
                  <ThemedText>{label.name} ×</ThemedText>
                </Pressable>
              ))
            : value[key] && (
                <Pressable
                  accessibilityRole="button"
                  disabled={locked}
                  style={{ padding: 12 }}
                  onPress={() => {
                    if (current()) onChange((old) => ({ ...old, [key]: null }));
                  }}
                >
                  <ThemedText>
                    {t(`taskPlanning.clear${key === "cycle" ? "Cycle" : "Episode"}`)}
                  </ThemedText>
                </Pressable>
              )}
        </View>
      ))}
      <Modal
        visible={!!kind && !locked}
        animationType="slide"
        onRequestClose={() => setKind(undefined)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          {kind && !locked && (
            <Options
              key={`${crewId}:${generation}:${kind}`}
              crewId={crewId}
              generation={generation}
              kind={kind}
              excludedIds={kind === "labels" ? value.labels.map((item) => item.id) : []}
              onClose={() => setKind(undefined)}
              onSelect={(item) => {
                if (!current()) return;
                onChange((old) =>
                  kind === "labels"
                    ? {
                        ...old,
                        labels:
                          old.labels.length >= 20 ||
                          old.labels.some((label) => label.id === item.id)
                            ? old.labels
                            : [...old.labels, item],
                      }
                    : { ...old, [kind]: item }
                );
                setKind(undefined);
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}
function Options({
  crewId,
  generation,
  kind,
  excludedIds,
  onSelect,
  onClose,
}: {
  crewId: string;
  generation: number;
  kind: PlanningKind;
  excludedIds: string[];
  onSelect: (item: PlanningOption) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ items?: PlanningOption[]; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskPlanningOptions(crewId, kind, controller.signal).then(
      (items) => {
        if (!controller.signal.aborted && generation === getAuthGeneration()) setState({ items });
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setState({ error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => controller.abort();
  }, [crewId, kind, generation, attempt]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t(`taskPlanning.${kind}`)}</ThemedText>
      {!state.items && !state.error && <ActivityIndicator />}
      {state.items?.length === 0 && <ThemedText>{t("taskPlanning.empty")}</ThemedText>}
      {state.items?.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          disabled={excludedIds.includes(item.id)}
          accessibilityState={{ disabled: excludedIds.includes(item.id) }}
          style={{ padding: 12, opacity: excludedIds.includes(item.id) ? 0.45 : 1 }}
          onPress={() => onSelect(item)}
        >
          <ThemedText>{item.name}</ThemedText>
        </Pressable>
      ))}
      {state.error && (
        <>
          <ThemedText accessibilityRole="alert">{state.error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setState({});
              setAttempt((n) => n + 1);
            }}
          >
            <ThemedText>{t("inbox.retry")}</ThemedText>
          </Pressable>
        </>
      )}
      <Pressable accessibilityRole="button" onPress={onClose}>
        <ThemedText>{t("common.cancel")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
