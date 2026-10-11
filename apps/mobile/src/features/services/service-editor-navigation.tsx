import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/build/react-navigation/core/usePreventRemove";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { useServiceEditorExitStatus } from "./service-editor-exit-state";

export function ServiceEditorNavigation() {
  const status = useServiceEditorExitStatus();
  const navigation = useNavigation();
  const [generation] = useState(getAuthGeneration);
  const [leave, setLeave] = useState<{ run(): void }>();
  const theme = useTheme(),
    t = useTranslations();
  usePreventRemove(status !== "clean", ({ data }) => {
    if (generation !== getAuthGeneration()) {
      navigation.dispatch(data.action);
      return;
    }
    if (status === "busy") return;
    setLeave({ run: () => navigation.dispatch(data.action) });
  });
  return (
    <Modal
      visible={!!leave}
      transparent
      animationType="fade"
      onRequestClose={() => setLeave(undefined)}
    >
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          padding: 24,
          backgroundColor: "rgba(0,0,0,0.7)",
        }}
      >
        <View
          accessibilityViewIsModal
          style={{
            padding: 16,
            gap: 12,
            borderRadius: 8,
            backgroundColor: theme.backgroundElement,
          }}
        >
          <ThemedText>{t("documentEditor.discardQuestion")}</ThemedText>
          <Pressable
            accessibilityRole="button"
            style={{ minHeight: 44, justifyContent: "center" }}
            onPress={() => setLeave(undefined)}
          >
            <ThemedText>{t("documentEditor.keepEditing")}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={status === "busy"}
            style={{ minHeight: 44, justifyContent: "center" }}
            onPress={() => {
              const run = leave?.run;
              setLeave(undefined);
              run?.();
            }}
          >
            <ThemedText>{t("documentEditor.discard")}</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
