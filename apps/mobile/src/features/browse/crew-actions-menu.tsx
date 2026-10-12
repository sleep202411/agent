import { useEffect, useRef } from "react";
import { Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/themed-text";
import { MaxContentWidth } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations, type MessageKey } from "@/i18n";

const actions = [
  ["tasks", "crewTasks.title"],
  ["applications", "crewDetail.applicationsAction"],
  ["reviews", "applicationReview.title"],
  ["invitations", "inviteManagement.title"],
  ["agreements", "crewAgreements.title"],
  ["finance", "crewFinance.title"],
  ["report", "report.reportAction"],
  ["block", "crewDetail.blockAction"],
] as const satisfies readonly (readonly [string, MessageKey])[];
export type CrewAction = (typeof actions)[number][0];

/** Keep all Crew destinations reachable without Android's three-button alert limit. */
export function CrewActionsMenu({
  visible,
  busy,
  onSelect,
  onClose,
}: {
  visible: boolean;
  busy: boolean;
  onSelect: (action: CrewAction) => void;
  onClose: () => void;
}) {
  const theme = useTheme(),
    t = useTranslations(),
    insets = useSafeAreaInsets();
  const pending = useRef<(() => void) | undefined>(undefined);
  useEffect(
    () => () => {
      pending.current = undefined;
    },
    []
  );
  const select = (action: CrewAction) => {
    if (pending.current) return;
    if (Platform.OS === "ios") {
      // Finish dismissing this native modal before opening a report or confirmation.
      pending.current = () => onSelect(action);
      onClose();
    } else onSelect(action);
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={() => {
        const action = pending.current;
        pending.current = undefined;
        action?.();
      }}
    >
      <Pressable
        accessible={false}
        onPress={onClose}
        style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" }}
      >
        <Pressable
          accessible={false}
          onPress={(event) => event.stopPropagation()}
          onAccessibilityEscape={onClose}
          style={{
            maxHeight: "85%",
            width: "100%",
            maxWidth: Platform.OS === "web" ? MaxContentWidth : undefined,
            alignSelf: "center",
            backgroundColor: theme.backgroundElement,
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: Math.max(12, insets.bottom),
            borderTopLeftRadius: 8,
            borderTopRightRadius: 8,
          }}
        >
          <ThemedText type="smallBold" style={{ paddingVertical: 12 }}>
            {t("report.moreActions")}
          </ThemedText>
          <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
            {actions.map(([action, label]) => {
              const disabled = busy && (action === "report" || action === "block");
              return (
                <Pressable
                  key={action}
                  accessibilityRole="button"
                  disabled={disabled}
                  accessibilityState={{ disabled }}
                  onPress={() => select(action)}
                  style={{
                    minHeight: 48,
                    paddingVertical: 12,
                    justifyContent: "center",
                    borderBottomWidth: 1,
                    borderBottomColor: theme.border,
                  }}
                >
                  <ThemedText
                    type="small"
                    themeColor={
                      disabled ? "textSecondary" : action === "block" ? "brand" : undefined
                    }
                  >
                    {t(label)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
          <View>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={{ minHeight: 48, alignItems: "center", justifyContent: "center" }}
            >
              <ThemedText type="smallBold">{t("report.cancel")}</ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
