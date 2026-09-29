import { ActionSheetIOS, Alert, Platform } from "react-native";
import { showContentActionsMenu } from "@/components/report-actions";
import type { MessageKey } from "@/i18n";

/** Crew follow-up lives in the existing ellipsis menu, without changing the detail layout. */
export function showCrewActionsMenu(options: {
  t: (key: MessageKey) => string;
  onApplications: () => void;
  onReviews?: () => void;
  onInvitations?: () => void;
  onFinance?: () => void;
  onAgreements?: () => void;
  onTasks?: () => void;
  onReport: () => void;
  onBlock: () => void;
}) {
  const {
    t,
    onApplications,
    onReport,
    onBlock,
    onTasks,
    onFinance,
    onAgreements,
    onInvitations,
    onReviews,
  } = options;
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [
          t("report.cancel"),
          t("crewDetail.applicationsAction"),
          t("report.reportAction"),
          t("crewDetail.blockAction"),
          ...(onTasks ? [t("crewTasks.title")] : []),
          ...(onFinance ? [t("crewFinance.title")] : []),
          ...(onAgreements ? [t("crewAgreements.title")] : []),
          ...(onInvitations ? [t("inviteManagement.title")] : []),
          ...(onReviews ? [t("applicationReview.title")] : []),
        ],
        cancelButtonIndex: 0,
        destructiveButtonIndex: 3,
      },
      (index) => {
        if (
          index ===
          4 +
            Number(!!onTasks) +
            Number(!!onFinance) +
            Number(!!onAgreements) +
            Number(!!onInvitations)
        )
          onReviews?.();
        if (index === 1) onApplications();
        if (index === 2) onReport();
        if (index === 3) onBlock();
        if (index === 4 && onTasks) onTasks();
        if (index === (onTasks ? 5 : 4)) onFinance?.();
        if (index === 4 + Number(!!onTasks) + Number(!!onFinance)) onAgreements?.();
        if (index === 4 + Number(!!onTasks) + Number(!!onFinance) + Number(!!onAgreements))
          onInvitations?.();
      }
    );
    return;
  }
  if (onReviews) {
    Alert.alert(t("report.moreActions"), undefined, [
      { text: t("applicationReview.title"), onPress: onReviews },
      {
        text: t("report.moreActions"),
        onPress: () =>
          showCrewActionsMenu({
            t,
            onApplications,
            onTasks,
            onAgreements,
            onFinance,
            onInvitations,
            onReport,
            onBlock,
          }),
      },
      { text: t("report.cancel"), style: "cancel" },
    ]);
    return;
  }
  if (onInvitations) {
    Alert.alert(t("report.moreActions"), undefined, [
      { text: t("inviteManagement.title"), onPress: onInvitations },
      {
        text: t("report.moreActions"),
        onPress: () =>
          showCrewActionsMenu({
            t,
            onApplications,
            onTasks,
            onAgreements,
            onFinance,
            onReport,
            onBlock,
          }),
      },
      { text: t("report.cancel"), style: "cancel" },
    ]);
    return;
  }
  if (onFinance) {
    Alert.alert(t("report.moreActions"), undefined, [
      { text: t("crewFinance.title"), onPress: onFinance },
      {
        text: t("report.moreActions"),
        onPress: () =>
          showCrewActionsMenu({ t, onApplications, onTasks, onAgreements, onReport, onBlock }),
      },
      { text: t("report.cancel"), style: "cancel" },
    ]);
    return;
  }
  if (onAgreements) {
    Alert.alert(t("report.moreActions"), undefined, [
      { text: t("crewAgreements.title"), onPress: onAgreements },
      {
        text: t("report.moreActions"),
        onPress: () => showCrewActionsMenu({ t, onApplications, onTasks, onReport, onBlock }),
      },
      { text: t("report.cancel"), style: "cancel" },
    ]);
    return;
  }
  if (onTasks) {
    Alert.alert(t("report.moreActions"), undefined, [
      { text: t("crewTasks.title"), onPress: onTasks },
      {
        text: t("report.moreActions"),
        onPress: () => showCrewActionsMenu({ t, onApplications, onReport, onBlock }),
      },
      { text: t("report.cancel"), style: "cancel" },
    ]);
    return;
  }
  // Android supports at most three Alert buttons. Keep safety actions in their
  // existing submenu instead of silently dropping the fourth button.
  Alert.alert(t("report.moreActions"), undefined, [
    { text: t("crewDetail.applicationsAction"), onPress: onApplications },
    {
      text: t("crewDetail.safetyActions"),
      onPress: () =>
        showContentActionsMenu({
          t,
          blockLabel: t("crewDetail.blockAction"),
          onReport,
          onBlock,
        }),
    },
    { text: t("report.cancel"), style: "cancel" },
  ]);
}
