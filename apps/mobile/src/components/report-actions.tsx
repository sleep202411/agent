/**
 * Shared report (举报) / block (屏蔽) UI for content detail screens (IP, crew).
 * The entry menu is the platform-native sheet; the reason picker is the app's
 * bottom-sheet idiom. Block wording differs per content type, so callers pass
 * their own block label/strings and submit handlers.
 */
import { SymbolView } from "expo-symbols";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { IP_REPORT_REASONS, type IpReportReason } from "@/data/ip-api";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations, type MessageKey } from "@/i18n";

type Translator = ReturnType<typeof useTranslations>;

const REASON_LABELS: Record<IpReportReason, MessageKey> = {
  copyright: "report.reasonCopyright",
  unsafe_content: "report.reasonUnsafeContent",
  fraud: "report.reasonFraud",
  misleading: "report.reasonMisleading",
  privacy: "report.reasonPrivacy",
  harassment: "report.reasonHarassment",
  other: "report.reasonOther",
};

/** Header ellipsis button that opens the report/block menu. */
export function MoreActionsButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" hitSlop={10} onPress={onPress}>
      <SymbolView
        name={{ ios: "ellipsis.circle", android: "more_horiz", web: "more_horiz" }}
        size={22}
        tintColor="#FFFFFF"
      />
    </Pressable>
  );
}

/** Entry menu: Report / Block / Cancel (native action sheet on iOS). */
export function showContentActionsMenu(opts: {
  t: Translator;
  blockLabel: string;
  onReport: () => void;
  onBlock: () => void;
}) {
  const { t, blockLabel, onReport, onBlock } = opts;
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [t("report.cancel"), t("report.reportAction"), blockLabel],
        cancelButtonIndex: 0,
        destructiveButtonIndex: 2,
      },
      (index) => {
        if (index === 1) onReport();
        if (index === 2) onBlock();
      }
    );
    return;
  }
  Alert.alert(t("report.moreActions"), undefined, [
    { text: t("report.reportAction"), onPress: onReport },
    { text: blockLabel, style: "destructive", onPress: onBlock },
    { text: t("report.cancel"), style: "cancel" },
  ]);
}

/** Bottom-sheet reason picker — submits on row tap (same idiom as LanguageSheet). */
export function ReportReasonSheet({
  visible,
  submitting,
  onSelect,
  onClose,
}: {
  visible: boolean;
  submitting: boolean;
  onSelect: (reason: IpReportReason) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessible={false}
        style={styles.sheetBackdrop}
        onPress={submitting ? undefined : onClose}
      >
        <Pressable
          accessible={false}
          onAccessibilityEscape={onClose}
          style={[styles.sheet, { backgroundColor: theme.backgroundElement }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.sheetHeader}>
            <ThemedText type="smallBold">{t("report.sheetTitle")}</ThemedText>
            {submitting ? <ActivityIndicator size="small" color={theme.textSecondary} /> : null}
          </View>
          {IP_REPORT_REASONS.map((reason) => (
            <Pressable
              key={reason}
              accessibilityRole="button"
              disabled={submitting}
              onPress={() => onSelect(reason)}
              style={({ pressed }) => (pressed ? styles.pressed : null)}
            >
              <View
                style={[styles.sheetRow, { borderBottomColor: theme.border, borderBottomWidth: 1 }]}
              >
                <ThemedText type="small" themeColor={submitting ? "textSecondary" : undefined}>
                  {t(REASON_LABELS[reason])}
                </ThemedText>
                <SymbolView
                  name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }}
                  size={13}
                  tintColor={theme.textSecondary}
                />
              </View>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            disabled={submitting}
            onPress={onClose}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <View style={[styles.sheetRow, styles.sheetCancelRow]}>
              <ThemedText type="smallBold" themeColor={submitting ? "textSecondary" : undefined}>
                {t("report.cancel")}
              </ThemedText>
            </View>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetBackdrop: {
    backgroundColor: "rgba(0,0,0,0.55)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: Spacing.six,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: Spacing.two,
  },
  sheetRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
  },
  sheetCancelRow: {
    borderBottomWidth: 0,
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.72,
  },
});
