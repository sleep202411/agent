import { Modal, Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";

export function StoryTopUpRecoveryDialog({
  error,
  onCancel,
  onContinue,
}: {
  error?: string;
  onCancel: () => void;
  onContinue?: () => void;
}) {
  const t = useTranslations();
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <ThemedText type="smallBold">
            {t(error ? "play.topUpReturn.error" : "play.topUpReturn.title")}
          </ThemedText>
          <ThemedText type="small">{error ?? t("play.topUpReturn.body")}</ThemedText>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onCancel} style={styles.button}>
              <ThemedText type="small">{t("common.cancel")}</ThemedText>
            </Pressable>
            {onContinue ? (
              <Pressable
                accessibilityRole="button"
                onPress={onContinue}
                style={[styles.button, styles.primary]}
              >
                <ThemedText type="smallBold">{t("play.topUpReturn.continue")}</ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#141414",
    borderRadius: 8,
    padding: 16,
    gap: 12,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 },
  button: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center", borderRadius: 8 },
  primary: { backgroundColor: "#E52227" },
});
