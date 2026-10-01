import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { PRESET_POSITIONS, type PresetPositionValue } from "@repo/shared/crew";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { crewPositionLabel } from "@/lib/crew-position-label";
import { fetchCrewSetup, type CrewSetupSnapshot } from "./crew-setup-api";
import type { CrewMember } from "./crew-members-api";
import { CrewMemberPositions } from "./crew-member-positions";
import { CrewTeamInvitations } from "./crew-team-invitations";
import { EpisodeTaskTemplate } from "./episode-task-template";
import { EpisodeManagement } from "./episode-management";
import { PositionCreate } from "./position-create";
import { useUserDisplays } from "./user-displays";

type Props = {
  crewId: string;
  userId: string;
  generation: number;
  onClose: () => void;
  onTasks: () => void;
};
type Editor =
  | { kind: "member"; role: PresetPositionValue; member: CrewMember }
  | { kind: "invite" | "publish"; role: PresetPositionValue }
  | { kind: "template"; episodeId: string }
  | { kind: "episodes" };
export function CrewSetup(props: Props) {
  const active = useScreenActive();
  return active && props.generation === getAuthGeneration() ? (
    <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations(),
    theme = useTheme();
  const [step, setStep] = useState<1 | 2 | 3>(1),
    [revision, setRevision] = useState(0),
    [editor, setEditor] = useState<Editor>(),
    [choosing, setChoosing] = useState<PresetPositionValue>();
  const [snapshot, setSnapshot] = useState<{
    revision: number;
    data?: CrewSetupSnapshot;
    error?: string;
  }>();
  const data = snapshot?.revision === revision ? snapshot.data : undefined;
  const displays = useUserDisplays(
    data ? `${props.userId}:${props.generation}` : undefined,
    data?.members.map((m) => m.userId) ?? []
  );
  const name = (member: CrewMember) => displays?.get(member.userId)?.nickname || member.userId;
  const reload = () => {
    setEditor(undefined);
    setChoosing(undefined);
    setRevision((v) => v + 1);
  };
  useEffect(() => {
    const controller = new AbortController();
    void fetchCrewSetup(props.crewId, props.userId, props.generation, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setSnapshot({ revision, data });
      },
      (error) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setSnapshot({ revision, error: error instanceof Error ? error.message : String(error) });
      }
    );
    return () => controller.abort();
  }, [props.crewId, props.userId, props.generation, revision]);
  const common = {
    crewId: props.crewId,
    userId: props.userId,
    generation: props.generation,
    onClose: reload,
  };
  if (editor?.kind === "member")
    return (
      <CrewMemberPositions
        {...common}
        member={editor.member}
        name={name(editor.member)}
        initialPosition={editor.role}
      />
    );
  if (editor?.kind === "invite")
    return <CrewTeamInvitations {...common} initialPosition={editor.role} />;
  if (editor?.kind === "publish")
    return (
      <PositionCreate {...common} initialPosition={editor.role} closeLabel={t("crewSetup.back")} />
    );
  if (editor?.kind === "template")
    return <EpisodeTaskTemplate {...common} initialEpisodeId={editor.episodeId} />;
  if (editor?.kind === "episodes") return <EpisodeManagement {...common} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("crewSetup.title")}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t("crewSetup.intro")}
      </ThemedText>
      <ThemedText type="smallBold">
        {step}. {t(`crewSetup.step${step}`)}
      </ThemedText>
      {snapshot?.revision !== revision && <ActivityIndicator />}
      {snapshot?.revision === revision && snapshot.error && (
        <ThemedText accessibilityRole="alert">{snapshot.error}</ThemedText>
      )}
      {data && (
        <>
          {step === 1 && (
            <>
              <ThemedText type="small">{t("crewSetup.membersHint")}</ThemedText>
              {PRESET_POSITIONS.map((role) => {
                const assigned = data.members.filter((m) =>
                  m.positions.some((p) => p.categoryKey === role.value)
                );
                const candidates = data.members.filter(
                  (m) => !assigned.includes(m) && m.positions.length < 12
                );
                const pending = data.invitations.filter(
                  (i) =>
                    i.positionCategory === role.value &&
                    i.status === "pending" &&
                    Date.parse(i.expiresAt) > Date.now()
                ).length;
                return (
                  <View
                    key={role.value}
                    style={{
                      padding: 12,
                      gap: 8,
                      borderRadius: 8,
                      backgroundColor: theme.backgroundElement,
                    }}
                  >
                    <ThemedText type="smallBold">{crewPositionLabel(role.value, t)}</ThemedText>
                    <ThemedText type="small">
                      {assigned.map(name).join(" · ") || t("crewSetup.vacant")}
                    </ThemedText>
                    {pending > 0 && (
                      <ThemedText type="small">
                        {t("crewSetup.pending").replace("{count}", String(pending))}
                      </ThemedText>
                    )}
                    <Action
                      label={t("crewSetup.addToRole").replace(
                        "{role}",
                        crewPositionLabel(role.value, t)
                      )}
                      disabled={!candidates.length}
                      onPress={() => setChoosing(choosing === role.value ? undefined : role.value)}
                    />
                    {choosing === role.value &&
                      candidates.map((member) => (
                        <Action
                          key={member.id}
                          label={name(member)}
                          onPress={() => setEditor({ kind: "member", role: role.value, member })}
                        />
                      ))}
                    {data.canInvite && (
                      <Action
                        label={t("crewSetup.invite")}
                        onPress={() => setEditor({ kind: "invite", role: role.value })}
                      />
                    )}
                  </View>
                );
              })}
              <Action label={t("crewSetup.confirmMembers")} onPress={() => setStep(2)} />
            </>
          )}
          {step === 2 && (
            <>
              <ThemedText type="small">{t("crewSetup.tasksHint")}</ThemedText>
              {!data.episodes.length && (
                <ThemedText type="small">{t("episodeManagement.empty")}</ThemedText>
              )}
              {data.episodes.map((episode) => (
                <View
                  key={episode.id}
                  style={{
                    padding: 12,
                    gap: 8,
                    backgroundColor: theme.backgroundElement,
                    borderRadius: 8,
                  }}
                >
                  <ThemedText type="smallBold">{episode.title}</ThemedText>
                  <ThemedText type="small">
                    {t("crewSetup.taskCount").replace(
                      "{count}",
                      String(episode.taskProgress.total)
                    )}
                  </ThemedText>
                  <Action
                    label={t("crewSetup.initialize")}
                    onPress={() => setEditor({ kind: "template", episodeId: episode.id })}
                  />
                </View>
              ))}
              <Action
                label={t("episodeManagement.title")}
                onPress={() => setEditor({ kind: "episodes" })}
              />
              <Action
                label={t("crewSetup.toAssignments")}
                disabled={!data.episodes.some((e) => e.taskProgress.total > 0)}
                onPress={() => setStep(3)}
              />
            </>
          )}
          {step === 3 && (
            <>
              <ThemedText type="small">{t("crewSetup.assignHint")}</ThemedText>
              {data.canPublish &&
                PRESET_POSITIONS.filter(
                  (role) =>
                    !data.members.some((m) => m.positions.some((p) => p.categoryKey === role.value))
                ).map((role) => (
                  <Action
                    key={role.value}
                    label={t("crewSetup.publish").replace(
                      "{role}",
                      crewPositionLabel(role.value, t)
                    )}
                    onPress={() => setEditor({ kind: "publish", role: role.value })}
                  />
                ))}
              <Action label={t("crewTasks.title")} onPress={props.onTasks} />
            </>
          )}
          {step !== 1 && (
            <Action label={t("crewSetup.back")} onPress={() => setStep(step === 3 ? 2 : 1)} />
          )}
        </>
      )}
      <Action label={t("crewSetup.refresh")} onPress={reload} />
      <Action label={t("report.close")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Action({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ paddingVertical: 10, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
