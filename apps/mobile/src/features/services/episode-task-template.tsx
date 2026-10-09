import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { fetchTaskPlanningOptions, type PlanningOption } from "./task-planning-api";
import {
  applyEpisodeTaskPlan,
  fetchEpisodeTaskPlan,
  type EpisodeTaskPlan,
} from "./episode-task-template-api";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  onClose: () => void;
  onStage?: (episode: PlanningOption, plan: EpisodeTaskPlan) => void;
};
export function EpisodeTaskTemplate(props: Props) {
  const active = useScreenActive();
  if (!active || props.generation !== getAuthGeneration()) return null;
  return <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />;
}
function Session({ crewId, userId, generation, onClose, onStage }: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0),
    [selected, setSelected] = useState<PlanningOption>();
  const [snapshot, setSnapshot] = useState<{
    revision: number;
    episodes?: PlanningOption[];
    error?: string;
    denied?: boolean;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const access = await fetchTaskCommentAccess(crewId, userId, controller.signal);
        if (controller.signal.aborted || generation !== getAuthGeneration()) return;
        if (!access.canManage) {
          setSnapshot({ revision, denied: true });
          return;
        }
        const episodes = await fetchTaskPlanningOptions(crewId, "episode", controller.signal);
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setSnapshot({ revision, episodes });
      } catch (cause) {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setSnapshot({ revision, error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => controller.abort();
  }, [crewId, userId, generation, revision]);
  if (selected)
    return (
      <Preview
        key={selected.id}
        crewId={crewId}
        episode={selected}
        generation={generation}
        onStage={onStage}
        onClose={() => setSelected(undefined)}
      />
    );
  const visible = snapshot?.revision === revision ? snapshot : undefined;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("episodeTaskTemplate.title")}</ThemedText>
      {!visible && <ActivityIndicator />}
      {visible?.denied && <ThemedText>{t("episodeTaskTemplate.denied")}</ThemedText>}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      {visible?.episodes?.length === 0 && (
        <ThemedText>{t("episodeTaskTemplate.noEpisodes")}</ThemedText>
      )}
      {visible?.episodes?.map((episode) => (
        <Pressable
          key={episode.id}
          accessibilityRole="button"
          style={{ padding: 12 }}
          onPress={() => {
            if (generation === getAuthGeneration()) setSelected(episode);
          }}
        >
          <ThemedText>{episode.name}</ThemedText>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setRevision((value) => value + 1);
        }}
      >
        <ThemedText>{t("thread.refresh")}</ThemedText>
      </Pressable>
      <Pressable accessibilityRole="button" style={{ padding: 12 }} onPress={onClose}>
        <ThemedText>{t("crewTasks.back")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
function Preview({
  crewId,
  episode,
  generation,
  onClose,
  onStage,
}: {
  crewId: string;
  episode: PlanningOption;
  generation: number;
  onClose: () => void;
  onStage?: Props["onStage"];
}) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    revision: number;
    plan?: EpisodeTaskPlan;
    error?: string;
  }>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [result, setResult] = useState<Awaited<ReturnType<typeof applyEpisodeTaskPlan>>>();
  const completed = useRef(false);
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetchEpisodeTaskPlan(crewId, episode.id, controller.signal).then(
      (plan) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setSnapshot({ revision, plan });
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setSnapshot({ revision, error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => controller.abort();
  }, [crewId, episode.id, generation, revision]);
  const visible = snapshot?.revision === revision ? snapshot : undefined;
  async function confirm() {
    if (
      lock.current ||
      completed.current ||
      result ||
      !visible?.plan ||
      generation !== getAuthGeneration()
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (onStage) {
        onStage(episode, visible.plan);
        completed.current = true;
        return;
      }
      const receipt = await applyEpisodeTaskPlan(crewId, episode.id, visible.plan, generation);
      completed.current = true;
      if (alive.current && generation === getAuthGeneration()) setResult(receipt);
    } catch (cause) {
      if (alive.current && generation === getAuthGeneration())
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      lock.current = false;
      if (alive.current && generation === getAuthGeneration()) setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{episode.name}</ThemedText>
      <ThemedText>
        {t(onStage ? "taskWorkbench.episodeStageHelp" : "episodeTaskTemplate.help")}
      </ThemedText>
      {!visible && <ActivityIndicator />}
      {(visible?.error || error) && (
        <ThemedText accessibilityRole="alert">{error ?? visible?.error}</ThemedText>
      )}
      {result && (
        <ThemedText>
          {t(result.replayed ? "episodeTaskTemplate.reused" : "episodeTaskTemplate.created")} ·{" "}
          {result.taskIds.length}
        </ThemedText>
      )}
      {visible?.plan && (
        <>
          <ThemedText>{visible.plan.name}</ThemedText>
          {visible.plan.items.map((item) => (
            <View key={item.templateKey} style={{ gap: 8, paddingVertical: 12 }}>
              <ThemedText>{item.title}</ThemedText>
              <ThemedText>
                {t("episodeTaskTemplate.role")} · {item.roleRequirement || "—"}
              </ThemedText>
              <ThemedText>
                {t("episodeTaskTemplate.dependencies")} ·{" "}
                {item.defaultDependencies
                  .map((key) => visible.plan!.items.find((row) => row.templateKey === key)!.title)
                  .join(", ") || "—"}
              </ThemedText>
            </View>
          ))}
        </>
      )}
      {!result && (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={busy || !visible?.plan}
            onPress={() => void confirm()}
            style={{ padding: 12 }}
          >
            <ThemedText>
              {t(
                busy
                  ? "episodeTaskTemplate.creating"
                  : onStage
                    ? "taskWorkbench.stageEpisode"
                    : "episodeTaskTemplate.confirm"
              )}
            </ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              if (!lock.current && generation === getAuthGeneration()) {
                setError(undefined);
                setRevision((value) => value + 1);
              }
            }}
            style={{ padding: 12 }}
          >
            <ThemedText>{t("thread.refresh")}</ThemedText>
          </Pressable>
        </>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          if (!lock.current) onClose();
        }}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("crewTasks.back")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
