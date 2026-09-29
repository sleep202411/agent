import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  fetchTaskKindTemplates,
  taskKindSchema,
  type TaskKind,
  type TaskKindTemplate,
} from "./task-kind-api";
export function TaskKindField({
  crewId,
  generation,
  selected,
  locked,
  onSelect,
}: {
  crewId: string;
  generation: number;
  selected: TaskKind | null;
  locked: boolean;
  onSelect: (kind: TaskKind | null, title?: string) => void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [open, setOpen] = useState(false);
  const current = () => !locked && generation === getAuthGeneration();
  return (
    <View style={{ gap: 8 }}>
      <ThemedText>{t("taskKind.label")}</ThemedText>
      <Pressable
        accessibilityRole="button"
        disabled={locked}
        style={{ padding: 12 }}
        onPress={() => {
          if (current()) setOpen(true);
        }}
      >
        <ThemedText>{t(selected ? `taskKind.${selected}` : "taskKind.unset")}</ThemedText>
      </Pressable>
      <Modal visible={open && !locked} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          {open && !locked && (
            <KindOptions
              key={`${crewId}:${generation}`}
              crewId={crewId}
              generation={generation}
              onClose={() => setOpen(false)}
              onSelect={(kind, title) => {
                if (current()) {
                  onSelect(kind, title);
                  setOpen(false);
                }
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}
function KindOptions({
  crewId,
  generation,
  onSelect,
  onClose,
}: {
  crewId: string;
  generation: number;
  onSelect: (kind: TaskKind | null, title?: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ items?: TaskKindTemplate[]; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskKindTemplates(crewId, controller.signal).then(
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
      <ThemedText type="smallBold">{t("taskKind.label")}</ThemedText>
      {!state.items && !state.error && <ActivityIndicator />}
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
      <Pressable accessibilityRole="button" style={{ padding: 12 }} onPress={() => onSelect(null)}>
        <ThemedText>{t("taskKind.unset")}</ThemedText>
      </Pressable>
      {taskKindSchema.options.map((kind) => (
        <Pressable
          key={kind}
          accessibilityRole="button"
          style={{ padding: 12 }}
          onPress={() => onSelect(kind, state.items?.find((item) => item.kind === kind)?.title)}
        >
          <ThemedText>{t(`taskKind.${kind}`)}</ThemedText>
        </Pressable>
      ))}
      <Pressable accessibilityRole="button" onPress={onClose}>
        <ThemedText>{t("common.cancel")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
