import { isTaskRequestReceipt } from "./task-request-receipt";
import {
  customFieldText,
  fetchTaskFieldDefinitions,
  type CustomField,
  type CustomValue,
} from "./task-custom-fields-api";
import { normalizeCustomValue } from "./task-custom-field-edit-api";
import { TaskCustomFieldControl } from "./task-custom-field-control";
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
  initialEpisodeId?: string;
  onStage?: (episode: PlanningOption, plan: EpisodeTaskPlan) => void;
};
export function EpisodeTaskTemplate(props: Props) {
  if (props.generation !== getAuthGeneration()) return null;
  return <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />;
}
function Session({ crewId, userId, generation, onClose, onStage, initialEpisodeId }: Props) {
  const active = useScreenActive();
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
        if (!access.canSubmit) {
          setSnapshot({ revision, denied: true });
          return;
        }
        const episodes = await fetchTaskPlanningOptions(crewId, "episode", controller.signal);
        if (!controller.signal.aborted && generation === getAuthGeneration()) {
          if (initialEpisodeId) {
            const target = episodes.find((episode) => episode.id === initialEpisodeId);
            if (!target)
              throw new Error("The selected episode is no longer available. Refresh setup.");
            setSelected(target);
          }
          setSnapshot({ revision, episodes });
        }
      } catch (cause) {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setSnapshot({ revision, error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => controller.abort();
  }, [crewId, userId, generation, revision, initialEpisodeId]);
  if (selected)
    return (
      <Preview
        key={selected.id}
        crewId={crewId}
        episode={selected}
        userId={userId}
        generation={generation}
        onStage={onStage}
        onClose={() => setSelected(undefined)}
      />
    );
  const visible = snapshot?.revision === revision ? snapshot : undefined;
  if (!active) return null;
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
  userId,
  crewId,
  episode,
  generation,
  onClose,
  onStage,
}: {
  crewId: string;
  episode: PlanningOption;
  userId: string;
  generation: number;
  onClose: () => void;
  onStage?: Props["onStage"];
}) {
  const active = useScreenActive();
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    revision: number;
    plan?: EpisodeTaskPlan;
    fields?: CustomField[];
    error?: string;
  }>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [result, setResult] = useState<Awaited<ReturnType<typeof applyEpisodeTaskPlan>>>();
  const [drafts, setDrafts] = useState<Record<string, Record<string, CustomValue>>>({});
  const [attempted, setAttempted] = useState<EpisodeTaskPlan>();
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
    void Promise.all([
      fetchEpisodeTaskPlan(crewId, episode.id, controller.signal),
      fetchTaskFieldDefinitions(crewId, controller.signal),
    ]).then(
      ([plan, fields]) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setSnapshot({ revision, plan, fields });
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setSnapshot({ revision, error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => controller.abort();
  }, [crewId, episode.id, generation, revision]);
  const visible = snapshot?.revision === revision ? snapshot : undefined;
  let prepared: EpisodeTaskPlan | undefined;
  if (visible?.plan && visible.fields) {
    try {
      const taskFields = visible.plan.items
        .map((item) => ({
          templateKey: item.templateKey,
          values: visible
            .fields!.map((field) => ({
              fieldId: field.id,
              value: normalizeCustomValue(field, drafts[item.templateKey]?.[field.id] ?? null),
            }))
            .filter((row) => row.value !== null),
        }))
        .filter((row) => row.values.length);
      prepared = taskFields.length
        ? {
            ...visible.plan,
            taskFields,
            fieldReview: Object.fromEntries(
              taskFields.map((row) => [
                row.templateKey,
                row.values.map((value) => {
                  const field = visible.fields!.find((field) => field.id === value.fieldId)!;
                  return `${field.name}: ${customFieldText(field, value.value, { unset: t("thread.taskUnset"), yes: t("taskCustomFields.yes"), no: t("taskCustomFields.no") })}`;
                }),
              ])
            ),
          }
        : visible.plan;
    } catch {
      /* Incomplete fields keep confirmation disabled. */
    }
  }
  async function confirm() {
    if (
      !active ||
      lock.current ||
      completed.current ||
      result ||
      !(attempted ?? prepared) ||
      generation !== getAuthGeneration()
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const command = attempted ?? prepared!;
      if (onStage) {
        onStage(episode, command);
        completed.current = true;
        return;
      }
      setAttempted(command);
      const receipt = await applyEpisodeTaskPlan(crewId, episode.id, command, generation);
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
  if (!active) return null;
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
          {t(
            isTaskRequestReceipt(result)
              ? `taskApproval.${result.status}`
              : result.replayed
                ? "episodeTaskTemplate.reused"
                : "episodeTaskTemplate.created"
          )}{" "}
          · {isTaskRequestReceipt(result) ? "" : result.taskIds.length}
        </ThemedText>
      )}
      {visible?.plan && (
        <>
          <ThemedText>{visible.plan.name}</ThemedText>
          {visible.plan.items.map((item) => (
            <View key={item.templateKey} style={{ gap: 8, paddingVertical: 12 }}>
              <ThemedText>{item.title}</ThemedText>
              {visible.fields?.map((field) => (
                <TaskCustomFieldControl
                  key={field.id}
                  field={field}
                  draft={drafts[item.templateKey]?.[field.id] ?? null}
                  locked={busy || !!attempted || !!result}
                  crewId={crewId}
                  userId={userId}
                  generation={generation}
                  setDraft={(value) => {
                    if (lock.current || attempted || generation !== getAuthGeneration()) return;
                    setDrafts((current) => ({
                      ...current,
                      [item.templateKey]: { ...current[item.templateKey], [field.id]: value },
                    }));
                  }}
                />
              ))}
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
            disabled={busy || !(attempted ?? prepared)}
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
            disabled={busy || !!attempted}
            onPress={() => {
              if (!lock.current && !attempted && generation === getAuthGeneration()) {
                setError(undefined);
                setDrafts({});
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
