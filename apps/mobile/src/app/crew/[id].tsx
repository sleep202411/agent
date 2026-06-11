import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/auth";
import {
  MoreActionsButton,
  promptSignIn,
  ReportReasonSheet,
  showContentActionsMenu,
} from "@/components/report-actions";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { EmptyState, PosterImage, SectionHeader, Tag } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { invalidateBrowse } from "@/data/browse-refresh";
import { blockCrew, getCrewById, reportCrew, type IpReportReason } from "@/data/browse-service";
import type { CrewDetail, CrewStatus, Person } from "@/data/types";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ApiRequestError } from "@/lib/api-client";

function crewStatusTag(
  status: CrewStatus,
  t: ReturnType<typeof useTranslations>
): {
  label: string;
  tone: "success" | "info" | "neutral";
} {
  if (status === "recruiting") return { label: t("crewDetail.statusRecruiting"), tone: "success" };
  if (status === "in-production")
    return { label: t("crewDetail.statusInProduction"), tone: "info" };
  return { label: t("crewDetail.statusClosed"), tone: "neutral" };
}

export default function CrewDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const t = useTranslations();
  const router = useRouter();
  const { status: authStatus } = useAuth();
  const [crew, setCrew] = useState<CrewDetail>();
  const [loading, setLoading] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const data = await getCrewById(id);
        if (alive) setCrew(data);
      } catch {
        if (alive) setCrew(undefined);
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) {
    return (
      <ThemedView style={styles.fullCenter}>
        <ActivityIndicator color={theme.textSecondary} />
      </ThemedView>
    );
  }

  if (!crew) {
    return (
      <ThemedView style={[styles.fullCenter, { padding: Spacing.four }]}>
        <EmptyState
          title={t("crewDetail.notFoundTitle")}
          detail={t("crewDetail.notFoundDetail")}
          symbol={{ ios: "person.2", android: "group", web: "group" }}
        />
      </ThemedView>
    );
  }

  const tag = crewStatusTag(crew.status, t);

  // Report/block require a signed-in viewer (Nest rejects anonymous calls).
  const requireSignIn = () => promptSignIn(t, () => router.push("/login"));

  const submitBlock = async () => {
    try {
      await blockCrew(crew.id);
      // The crews list is filtered server-side for this viewer; nudge it to
      // refetch, then leave the page.
      invalidateBrowse();
      Alert.alert(t("crewDetail.blockSuccessTitle"), t("crewDetail.blockSuccessBody"), [
        { text: t("report.close"), onPress: () => router.back() },
      ]);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        requireSignIn();
        return;
      }
      Alert.alert(t("crewDetail.blockFailed"));
    }
  };

  const confirmBlock = () => {
    Alert.alert(t("crewDetail.blockConfirmTitle"), t("crewDetail.blockConfirmBody"), [
      { text: t("report.cancel"), style: "cancel" },
      {
        text: t("crewDetail.blockConfirmAction"),
        style: "destructive",
        onPress: () => void submitBlock(),
      },
    ]);
  };

  const submitReport = async (reason: IpReportReason) => {
    setReporting(true);
    try {
      await reportCrew(crew.id, reason);
      setReportOpen(false);
      Alert.alert(t("report.successTitle"), t("report.successBody"));
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        setReportOpen(false);
        requireSignIn();
        return;
      }
      Alert.alert(t("report.failed"));
    } finally {
      setReporting(false);
    }
  };

  const openActions = () => {
    if (authStatus !== "authenticated") {
      requireSignIn();
      return;
    }
    showContentActionsMenu({
      t,
      blockLabel: t("crewDetail.blockAction"),
      onReport: () => setReportOpen(true),
      onBlock: confirmBlock,
    });
  };

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <MoreActionsButton label={t("report.moreActions")} onPress={openActions} />
          ),
        }}
      />
      <ReportReasonSheet
        visible={reportOpen}
        submitting={reporting}
        onSelect={(reason) => void submitReport(reason)}
        onClose={() => setReportOpen(false)}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.seven }}
      >
        <View style={styles.backdrop}>
          <PosterImage
            uri={crew.coverUrl}
            label={crew.name}
            radius={0}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.scrim} />
          <View style={styles.backdropCopy}>
            <ThemedText type="subtitle" style={styles.title} numberOfLines={2}>
              {crew.name}
            </ThemedText>
            {crew.tagline ? (
              <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
                {crew.tagline}
              </ThemedText>
            ) : null}
            <View style={styles.metaRow}>
              <Tag label={tag.label} tone={tag.tone} />
              {crew.location ? (
                <View style={styles.metaItem}>
                  <SymbolView
                    name={{ ios: "mappin", android: "place", web: "place" }}
                    size={12}
                    tintColor={theme.textSecondary}
                  />
                  <ThemedText type="code" themeColor="textSecondary">
                    {crew.location}
                  </ThemedText>
                </View>
              ) : null}
              {crew.memberCount ? (
                <ThemedText type="code" themeColor="textSecondary">
                  {crew.memberCount} {t("crewDetail.membersSuffix")}
                </ThemedText>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.body}>
          <ThemedText type="small" themeColor="textSecondary">
            {crew.description}
          </ThemedText>

          {crew.roles.length ? (
            <View style={styles.section}>
              <SectionHeader
                title={t("crewDetail.openRolesTitle")}
                trailing={`${crew.openRoles} ${t("crewDetail.openSuffix")}`}
              />
              <ThemedView type="backgroundElement" style={styles.rolePanel}>
                {crew.roles.map((role, index) => (
                  <View
                    key={role.id}
                    style={[
                      styles.roleRow,
                      index < crew.roles.length - 1 && {
                        borderBottomColor: theme.border,
                        borderBottomWidth: 1,
                      },
                    ]}
                  >
                    <View style={styles.roleCopy}>
                      <ThemedText type="smallBold">{role.title}</ThemedText>
                      {role.note ? (
                        <ThemedText type="code" themeColor="textSecondary">
                          {role.note}
                        </ThemedText>
                      ) : null}
                    </View>
                    <Tag label={`${role.count} ${t("crewDetail.openSuffix")}`} tone="brand" />
                  </View>
                ))}
              </ThemedView>
            </View>
          ) : null}

          {crew.members.length ? (
            <View style={styles.section}>
              <SectionHeader title={t("crewDetail.membersTitle")} />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.membersRow}
              >
                {crew.members.map((member) => (
                  <MemberChip key={member.id} member={member} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          {crew.status === "recruiting" ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {}}
              style={({ pressed }) => [
                styles.applyButton,
                { backgroundColor: theme.brand },
                pressed && styles.pressed,
              ]}
            >
              <ThemedText type="smallBold" style={styles.applyText}>
                {t("crewDetail.applyButton")}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function MemberChip({ member }: { member: Person }) {
  const theme = useTheme();
  const initial = member.name.trim().slice(0, 1).toUpperCase();
  return (
    <View style={styles.memberChip}>
      <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {initial}
        </ThemedText>
      </View>
      <ThemedText type="code" numberOfLines={1}>
        {member.name}
      </ThemedText>
      {member.role ? (
        <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
          {member.role}
        </ThemedText>
      ) : null}
    </View>
  );
}

const AVATAR = 54;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fullCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: Spacing.four },
  backdrop: { height: 240, justifyContent: "flex-end" },
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(7,8,12,0.4)",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
  },
  backdropCopy: { padding: Spacing.four, gap: Spacing.one },
  title: { fontSize: 28, lineHeight: 32 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    marginTop: Spacing.half,
  },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  body: { padding: Spacing.four, gap: Spacing.five },
  section: { gap: Spacing.two },
  rolePanel: { borderRadius: 8, overflow: "hidden" },
  roleRow: {
    minHeight: 60,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  roleCopy: { flex: 1, minWidth: 0, gap: 2 },
  membersRow: { gap: Spacing.four, paddingRight: Spacing.four },
  memberChip: { width: AVATAR + 12, alignItems: "center", gap: 4 },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  applyButton: {
    height: 50,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  applyText: { color: "#FFFFFF" },
  pressed: { opacity: 0.82 },
});
