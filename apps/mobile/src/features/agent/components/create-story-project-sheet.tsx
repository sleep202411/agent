import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";

import { CreateStoryProjectForm, type CreateStoryProjectValues } from "./create-story-project-form";

const theme = Colors.dark;

type CreateStoryProjectSheetProps = {
  visible: boolean;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (values: CreateStoryProjectValues) => void;
};

/** Bottom-sheet wrapper around the shared create form. */
export function CreateStoryProjectSheet({
  visible,
  busy = false,
  onClose,
  onSubmit,
}: CreateStoryProjectSheetProps) {
  const t = useTranslations();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.avoid}
      >
        <Pressable accessible={false} style={styles.backdrop} onPress={busy ? undefined : onClose}>
          <Pressable
            accessible={false}
            onAccessibilityEscape={onClose}
            style={[styles.sheet, { backgroundColor: theme.backgroundElement }]}
            onPress={(e) => e.stopPropagation()}
          >
            <ThemedText type="smallBold">{t("agent.createSheetTitle")}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t("agent.createSheetDescription")}
            </ThemedText>

            <CreateStoryProjectForm busy={busy} reset={!visible} onSubmit={onSubmit} />
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export type { CreateStoryProjectValues };

const styles = StyleSheet.create({
  avoid: {
    flex: 1,
  },
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.55)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: Spacing.two,
    paddingBottom: Spacing.six,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
  },
});
