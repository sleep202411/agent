import { Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/themed-text";
import { MaxContentWidth } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { crewPositionLabel } from "@/lib/crew-position-label";
import type { CrewRoleOpening } from "@/data/types";

/** Native alerts truncate Android choices to three; openings need a scrollable list. */
export function CrewRolePicker({
  visible,
  roles,
  onSelect,
  onClose,
}: {
  visible: boolean;
  roles: CrewRoleOpening[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme(),
    t = useTranslations(),
    insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
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
            maxHeight: "70%",
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
            {t("crewDetail.applyPickTitle")}
          </ThemedText>
          <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
            {roles.map((role) => (
              <Pressable
                key={role.id}
                accessibilityRole="button"
                onPress={() => onSelect(role.id)}
                style={{
                  minHeight: 48,
                  paddingVertical: 12,
                  justifyContent: "center",
                  borderBottomWidth: 1,
                  borderBottomColor: theme.border,
                }}
              >
                <ThemedText type="small">
                  {crewPositionLabel(role.positionType ?? role.title, t)}
                </ThemedText>
              </Pressable>
            ))}
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
