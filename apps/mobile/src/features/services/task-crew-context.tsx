import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { TaskMentionPicker } from "./task-mention-picker";
import { fetchTaskCrewIntroduction, appendTaskContext } from "./task-crew-context-api";
export function TaskCrewContext(props: {
  crewId: string;
  userId: string;
  generation: number;
  description: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const op = useAuthFormOperation(`${props.crewId}:${props.generation}`, !props.disabled);
  const [picker, setPicker] = useState(false),
    [error, setError] = useState<string>();
  const current = useRef(props);
  useLayoutEffect(() => {
    current.current = props;
  });
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    if (props.disabled) request.current?.abort();
    return () => request.current?.abort();
  }, [props.crewId, props.generation, props.disabled]);
  const append = (text: string) => {
    if (current.current.disabled) return;
    try {
      current.current.onChange(appendTaskContext(current.current.description, text));
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        disabled={props.disabled || op.busy}
        style={{ padding: 12, minHeight: 44 }}
        onPress={() => setPicker(true)}
      >
        <ThemedText>{t("crewTaskContext.creator")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={props.disabled || op.busy}
        style={{ padding: 12, minHeight: 44 }}
        onPress={() => {
          void op.run(
            async () => {
              const controller = new AbortController();
              request.current = controller;
              setError(undefined);
              return fetchTaskCrewIntroduction(props.crewId, props.generation, controller.signal);
            },
            (text) => {
              if (!text.trim()) setError(t("crewTaskContext.empty"));
              else append(`${t("crewTaskContext.introduction")}\n${text.trim()}`);
            },
            (e) => setError(e instanceof Error ? e.message : String(e))
          );
        }}
      >
        <ThemedText>{t("crewTaskContext.load")}</ThemedText>
      </Pressable>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Modal
        visible={picker && !props.disabled}
        animationType="slide"
        onRequestClose={() => setPicker(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          {picker && !props.disabled ? (
            <TaskMentionPicker
              crewId={props.crewId}
              userId={props.userId}
              generation={props.generation}
              includeSelf
              title={t("crewTaskContext.creator")}
              excludedIds={[]}
              onClose={() => setPicker(false)}
              onSelect={(member) => {
                append(`${t("crewTaskContext.creator")}: ${member.label}`);
                setPicker(false);
              }}
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}
