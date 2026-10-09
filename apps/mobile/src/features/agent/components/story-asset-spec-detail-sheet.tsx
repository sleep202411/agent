import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import type { StoryAssetSpec } from "@/features/agent/api/story-production-api";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

function statusLabelKey(status: StoryAssetSpec["status"]) {
  if (status === "archived") return "agent.assets.status.archived" as const;
  return "agent.assets.status.current" as const;
}

/** Read-only asset detail sheet — mirrors H5 detail inspection without edit/generate. */
export function StoryAssetSpecDetailSheet({
  asset,
  visible,
  onClose,
}: {
  asset: StoryAssetSpec | null;
  visible: boolean;
  onClose: () => void;
}) {
  const t = useTranslations();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  if (!asset) return null;

  const reference = asset.stableKey.startsWith("@") ? asset.stableKey : `@${asset.stableKey}`;
  const prompt = asset.imagePrompt?.trim() || "—";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: theme.backgroundElement,
              paddingBottom: Math.max(insets.bottom, Spacing.four),
            },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.handle} />
          <ThemedText type="smallBold" style={styles.title}>
            {asset.name}
          </ThemedText>
          <ThemedText type="code" themeColor="textSecondary">
            {t(`agent.assets.tabs.${asset.kind}`)} · {reference}
          </ThemedText>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Field label={t("agent.assets.detail.status")}>
              <ThemedText type="small">{t(statusLabelKey(asset.status))}</ThemedText>
            </Field>
            <Field label={t("agent.assets.detail.description")}>
              <ThemedText type="small" themeColor="textSecondary">
                {asset.description?.trim() || "—"}
              </ThemedText>
            </Field>
            <Field label={t("agent.assets.detail.imagePrompt")}>
              <ThemedText type="small" themeColor="textSecondary">
                {prompt}
              </ThemedText>
            </Field>
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeBtn,
              { backgroundColor: theme.backgroundSelected },
              pressed && styles.pressed,
            ]}
          >
            <ThemedText type="smallBold">{t("agent.assets.detail.close")}</ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText type="code" themeColor="textSecondary">
        {label}
      </ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    maxHeight: "78%",
    gap: Spacing.two,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginBottom: Spacing.two,
  },
  title: {
    fontSize: 17,
  },
  body: {
    marginTop: Spacing.two,
  },
  bodyContent: {
    gap: Spacing.four,
    paddingBottom: Spacing.three,
  },
  field: {
    gap: Spacing.one,
  },
  closeBtn: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    borderRadius: 12,
  },
  pressed: {
    opacity: 0.85,
  },
});
