import { crewApplicationError } from "@/features/browse/crew-qualification-error";
import { CrewLinkedResources } from "@/features/services/crew-linked-resources";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, useAuthGate } from "@/auth";
import { MoreActionsButton, ReportReasonSheet } from "@/components/report-actions";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { EmptyState, PosterImage, SectionHeader, Tag } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { invalidateBrowse } from "@/data/browse-refresh";
import { getCrewById, type IpReportReason } from "@/data/browse-service";
import type { CrewDetail, CrewRoleOpening, CrewStatus, Person } from "@/data/types";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { type MessageKey, useTranslations } from "@/i18n";
import { ApiRequestError } from "@/lib/api-client";
import { CrewRolePicker } from "@/features/browse/crew-role-picker";
import { useCrewModeration } from "@/features/browse/use-crew-moderation";
import { useCrewApplication } from "@/features/browse/use-crew-application";
import { crewPositionLabel } from "@/lib/crew-position-label";
import { CrewActionsMenu, type CrewAction } from "@/features/browse/crew-actions-menu";
import { toHref } from "@/lib/navigation";

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

const EMPLOYMENT_LABELS: Record<string, MessageKey> = {
  full_time: "crewDetail.employmentFullTime",
  part_time: "crewDetail.employmentPartTime",
  contract: "crewDetail.employmentContract",
  freelance: "crewDetail.employmentFreelance",
  project_based: "crewDetail.employmentProjectBased",
};

function CrewReadState({ children }: { children?: ReactNode }) {
  return (
    <>
      <Stack.Screen options={{ headerRight: () => null }} />
      {children}
    </>
  );
}

export default function CrewDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const t = useTranslations();
  const router = useRouter();
  const authGate = useAuthGate();
  const auth = useAuth();
  const active = useScreenActive();
  const [revision, setRevision] = useState(0);
  const scope = useMemo(
    () => ({ id, generation: auth.generation, status: auth.status, active, revision, t }),
    [id, auth.generation, auth.status, active, revision, t]
  );
  const [read, setRead] = useState<{ scope: typeof scope; crew?: CrewDetail; error?: string }>();
  const [rolePicker, setRolePicker] = useState<{ crewId: string; generation: number }>();
  const moderation = useCrewModeration(id, auth.generation, active);
  const [actionsIntent, setActionsIntent] = useState<{ crewId: string; generation: number }>();
  const [reportScope, setReportScope] = useState<typeof moderation.scope>();
  const { applying, submit: apply } = useCrewApplication(id);

  useEffect(() => {
    if (!scope.active || scope.status === "hydrating") return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && scope.generation === getAuthGeneration();
    void getCrewById(scope.id, controller.signal).then(
      (crew) => {
        if (current()) setRead({ scope, crew });
      },
      (error) => {
        if (current())
          setRead({
            scope,
            error:
              error instanceof Error && error.message.trim()
                ? error.message
                : scope.t("crews.loadErrorFallback"),
          });
      }
    );
    return () => controller.abort();
  }, [scope]);

  const crew = read?.scope === scope ? read.crew : undefined;
  const selectAction = (action: CrewAction) => {
    if (!crew || !moderation.isCurrent()) return;
    setActionsIntent(undefined);
    if (action === "report") {
      setReportScope(moderation.scope);
      return;
    }
    if (action === "block") {
      confirmBlock();
      return;
    }
    const paths = {
      applications: "/crew-applications",
      agreements: `/crew-agreements/${encodeURIComponent(crew.id)}`,
      reviews: `/crew-reviews/${encodeURIComponent(crew.id)}`,
      invitations: `/crew-invitations/${encodeURIComponent(crew.id)}`,
      finance: `/crew-finance/${encodeURIComponent(crew.id)}`,
      tasks: `/crew-tasks/${encodeURIComponent(crew.id)}`,
    };
    router.push(toHref(paths[action]));
  };

  const moderationError = (title: string, error: unknown) => {
    if (error instanceof ApiRequestError && error.status === 401) {
      setReportScope(undefined);
      authGate.openLogin();
      return;
    }
    Alert.alert(title, error instanceof Error && error.message.trim() ? error.message : undefined);
  };

  const submitBlock = () =>
    moderation.submit(
      undefined,
      () => {
        invalidateBrowse();
        Alert.alert(t("crewDetail.blockSuccessTitle"), t("crewDetail.blockSuccessBody"), [
          {
            text: t("report.close"),
            onPress: () => {
              if (moderation.isCurrent()) router.back();
            },
          },
        ]);
      },
      (error) => moderationError(t("crewDetail.blockFailed"), error)
    );

  const confirmBlock = () => {
    if (!moderation.isCurrent() || moderation.submitting) return;
    Alert.alert(t("crewDetail.blockConfirmTitle"), t("crewDetail.blockConfirmBody"), [
      { text: t("report.cancel"), style: "cancel" },
      {
        text: t("crewDetail.blockConfirmAction"),
        style: "destructive",
        onPress: () => void submitBlock(),
      },
    ]);
  };

  const submitReport = (reason: IpReportReason) =>
    moderation.submit(
      reason,
      () => {
        setReportScope(undefined);
        Alert.alert(t("report.successTitle"), t("report.successBody"));
      },
      (error) => moderationError(t("report.failed"), error)
    );

  const openActions = () => {
    authGate.requireAuth({
      onAuthenticated: () => setActionsIntent({ crewId: id, generation: getAuthGeneration() }),
    });
  };

  // Hide stale recruitment/access data immediately while a return or account change is read.
  // Keep the component mounted so pending application requests remain serialized.
  if (!active || auth.status === "hydrating") return <CrewReadState />;
  const loadError = read?.scope === scope ? read.error : undefined;
  if (read?.scope !== scope) {
    return (
      <CrewReadState>
        <ThemedView style={styles.fullCenter}>
          <ActivityIndicator color={theme.textSecondary} />
        </ThemedView>
      </CrewReadState>
    );
  }

  if (loadError) {
    return (
      <CrewReadState>
        <ThemedView style={[styles.fullCenter, { padding: Spacing.four }]}>
          <EmptyState title={t("crews.loadErrorTitle")} detail={loadError} />
          <Pressable
            accessibilityRole="button"
            onPress={() => setRevision((value) => value + 1)}
            style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: Spacing.four }}
          >
            <ThemedText>{t("common.retry")}</ThemedText>
          </Pressable>
        </ThemedView>
      </CrewReadState>
    );
  }

  if (!crew) {
    return (
      <CrewReadState>
        <ThemedView style={[styles.fullCenter, { padding: Spacing.four }]}>
          <EmptyState
            title={t("crewDetail.notFoundTitle")}
            detail={t("crewDetail.notFoundDetail")}
            symbol={{ ios: "person.2", android: "group", web: "group" }}
          />
        </ThemedView>
      </CrewReadState>
    );
  }

  const tag = crewStatusTag(crew.status, t);
  const roleTitle = (role: CrewRoleOpening) =>
    crewPositionLabel(role.positionType ?? role.title, t);

  const submitApply = async (positionId: string) => {
    await apply(
      positionId,
      (applicationId) => {
        router.push(toHref(`/crew-applications?application=${encodeURIComponent(applicationId)}`));
      },
      (error) => {
        if (error instanceof ApiRequestError && error.status === 401) {
          authGate.openLogin({ onAuthenticated: () => void submitApply(positionId) });
          return;
        }
        const detail = crewApplicationError(error, t);
        Alert.alert(t("crewDetail.applyFailed"), detail);
      }
    );
  };

  const roleMeta = (role: CrewRoleOpening) => {
    const parts: string[] = [];
    if (role.location) parts.push(role.location);
    const key = role.employmentType ? EMPLOYMENT_LABELS[role.employmentType] : undefined;
    if (key) parts.push(t(key));
    return parts.join(" · ");
  };

  const handleApply = () => {
    authGate.requireAuth({
      onAuthenticated: () => setRolePicker({ crewId: id, generation: getAuthGeneration() }),
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
      <CrewRolePicker
        visible={
          rolePicker?.crewId === crew.id &&
          rolePicker.generation === auth.generation &&
          crew.roles.length > 0
        }
        roles={crew.roles}
        onClose={() => setRolePicker(undefined)}
        onSelect={(positionId) => {
          if (auth.generation !== getAuthGeneration() || applying) return;
          setRolePicker(undefined);
          void submitApply(positionId);
        }}
      />
      <CrewActionsMenu
        visible={
          auth.status === "authenticated" &&
          actionsIntent?.crewId === id &&
          actionsIntent.generation === auth.generation
        }
        busy={moderation.submitting}
        onSelect={selectAction}
        onClose={() => setActionsIntent(undefined)}
      />
      <ReportReasonSheet
        visible={reportScope === moderation.scope}
        submitting={moderation.submitting}
        onSelect={(reason) => void submitReport(reason)}
        onClose={() => {
          if (!moderation.submitting) setReportScope(undefined);
        }}
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

          <CrewLinkedResources crewId={crew.id} />

          {crew.roles.length ? (
            <View style={styles.section}>
              <SectionHeader
                title={t("crewDetail.openRolesTitle")}
                trailing={`${crew.openRoles} ${t("crewDetail.openSuffix")}`}
              />
              <ThemedView type="backgroundElement" style={styles.rolePanel}>
                {crew.roles.map((role, index) => {
                  const meta = roleMeta(role);
                  return (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        router.push(
                          toHref(
                            `/crew-opening?crewId=${encodeURIComponent(crew.id)}&positionId=${encodeURIComponent(role.id)}`
                          )
                        )
                      }
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
                        <ThemedText type="smallBold">{roleTitle(role)}</ThemedText>
                        {meta ? (
                          <ThemedText type="code" themeColor="textSecondary">
                            {meta}
                          </ThemedText>
                        ) : null}
                      </View>
                      <Tag label={`${role.count} ${t("crewDetail.openSuffix")}`} tone="brand" />
                    </Pressable>
                  );
                })}
              </ThemedView>
              <Pressable
                accessibilityRole="button"
                disabled={applying}
                onPress={handleApply}
                style={({ pressed }) => (pressed ? styles.pressed : null)}
              >
                <View style={[styles.applyButton, { backgroundColor: theme.brand }]}>
                  {applying ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <ThemedText type="smallBold" style={styles.applyText}>
                      {t("crewDetail.applyButton")}
                    </ThemedText>
                  )}
                </View>
              </Pressable>
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
  applyButton: {
    height: 50,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.three,
  },
  applyText: { color: "#FFFFFF" },
  membersRow: { gap: Spacing.four, paddingRight: Spacing.four },
  memberChip: { width: AVATAR + 12, alignItems: "center", gap: 4 },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.82 },
});
