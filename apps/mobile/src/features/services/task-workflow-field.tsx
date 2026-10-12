import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { fetchManualTaskWorkflows, type TaskWorkflow } from "./task-workflow-api";

export function TaskWorkflowField({
  crewId,
  generation,
  selected,
  locked,
  allowDefault = true,
  onSelect,
}: {
  crewId: string;
  generation: number;
  selected: TaskWorkflow | null;
  locked: boolean;
  allowDefault?: boolean;
  onSelect: (value: TaskWorkflow | null) => void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [open, setOpen] = useState(false);
  const current = () => !locked && generation === getAuthGeneration();
  return (
    <View style={{ gap: 8 }}>
      <ThemedText>{t("taskCreate.workflow")}</ThemedText>
      <Pressable
        accessibilityRole="button"
        disabled={locked}
        style={{ padding: 12 }}
        onPress={() => {
          if (current()) setOpen(true);
        }}
      >
        <ThemedText>{selected?.name ?? t("taskCreate.defaultWorkflow")}</ThemedText>
      </Pressable>
      <Modal visible={open && !locked} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          {open && !locked && (
            <WorkflowOptions
              key={`${crewId}:${generation}`}
              allowDefault={allowDefault}
              crewId={crewId}
              generation={generation}
              onSelect={(value) => {
                if (current()) {
                  onSelect(value);
                  setOpen(false);
                }
              }}
              onClose={() => setOpen(false)}
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}
function WorkflowOptions({
  allowDefault,
  crewId,
  generation,
  onSelect,
  onClose,
}: {
  crewId: string;
  generation: number;
  allowDefault: boolean;
  onSelect: (value: TaskWorkflow | null) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ items?: TaskWorkflow[]; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    void fetchManualTaskWorkflows(crewId, controller.signal).then(
      (items) => {
        if (!controller.signal.aborted && generation === getAuthGeneration()) setState({ items });
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setState({ error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => controller.abort();
  }, [crewId, generation, attempt]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("taskCreate.workflow")}</ThemedText>
      {allowDefault && (
        <Pressable
          accessibilityRole="button"
          style={{ padding: 12 }}
          onPress={() => onSelect(null)}
        >
          <ThemedText>{t("taskCreate.defaultWorkflow")}</ThemedText>
        </Pressable>
      )}
      {!state.items && !state.error && <ActivityIndicator />}
      {state.items?.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          style={{ padding: 12 }}
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
