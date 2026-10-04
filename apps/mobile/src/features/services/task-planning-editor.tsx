import { TaskCompensationFields } from "./task-compensation-fields";
import { compensationText } from "./task-compensation";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import {
  useTaskPlanningSession,
  parsePlanningDraft,
  type TaskPlanningSession,
} from "./use-task-planning-session";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { fetchTaskPlanning, type PlanningSnapshot } from "./task-planning-edit-api";
import { useTheme } from "@/hooks/use-theme";
import { TaskKindField } from "./task-kind-field";
import { TaskPlanningFields } from "./task-planning-fields";
import type { TaskDetail } from "./task-detail-api";
type Props = {
  task: TaskDetail;
  userId: string;
  generation: number;
  onRefresh: () => void;
  session?: TaskPlanningSession;
};
export function TaskPlanningEditor(props: Props) {
  if (props.session) return <PlanningAccess {...props} session={props.session} />;
  return <LocalPlanning key={`${props.task.id}:${props.generation}`} {...props} />;
}
function LocalPlanning(props: Props) {
  const session = useTaskPlanningSession(props.task.id, props.generation, props.onRefresh);
  return <PlanningAccess {...props} session={session} />;
}
function PlanningAccess(props: Props & { session: TaskPlanningSession }) {
  if (["approved", "cancelled"].includes(props.task.status)) return null;
  return <Access key={`${props.task.id}:${props.task.version}:${props.generation}`} {...props} />;
}
function Access({
  task,
  userId,
  generation,
  onRefresh,
  session,
}: Props & { session: TaskPlanningSession }) {
  const t = useTranslations();
  const [allowed, setAllowed] = useState<boolean>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskCommentAccess(task.crewId, userId, controller.signal).then(
      (access) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setAllowed(access.canManage);
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [task.crewId, userId, generation]);
  if (allowed === false) return null;
  if (session.editing && allowed)
    return (
      <LoadEditor task={task} generation={generation} onRefresh={onRefresh} session={session} />
    );
  return (
    <View style={{ gap: 8 }}>
      {allowed === undefined && !error && <ActivityIndicator />}

      {error && (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable onPress={onRefresh}>
            <ThemedText>{t("thread.refresh")}</ThemedText>
          </Pressable>
        </>
      )}
      {allowed && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (generation === getAuthGeneration()) session.open();
          }}
          style={{ padding: 12 }}
        >
          <ThemedText>{t("taskPlanning.edit")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

function LoadEditor(props: Omit<Props, "userId"> & { session: TaskPlanningSession }) {
  const t = useTranslations();
  const initialize = props.session.initialize;
  const [snapshot, setSnapshot] = useState<PlanningSnapshot>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskPlanning(props.task, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration()) {
          initialize(value);
          setSnapshot(value);
        }
      },
      (cause) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [props.task, props.generation, initialize]);
  if (snapshot && props.session.draft) return <Editor {...props} snapshot={snapshot} />;
  return (
    <View style={{ gap: 8 }}>
      {!error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Pressable
        accessibilityRole="button"
        onPress={error ? props.onRefresh : props.session.cancel}
      >
        <ThemedText>{t(error ? "thread.refresh" : "myServices.cancel")}</ThemedText>
      </Pressable>
    </View>
  );
}
function Editor({
  snapshot,
  generation,
  onRefresh,
  session,
}: {
  snapshot: PlanningSnapshot;
  generation: number;
  onRefresh: () => void;
  session: TaskPlanningSession;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const draft = session.draft!;
  const { reward, share, estimate, revisionLimit, taskKind, positionRole, error } = draft;
  const locked = session.busy || !!draft.attemptedAt;
  const stale = snapshot.version !== draft.snapshot.version;
  const canReview =
    !session.busy && (stale || (!!draft.attemptedAt && snapshot !== draft.attemptedAt));
  const parsed = parsePlanningDraft(draft);
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("taskPlanning.edit")}</ThemedText>

      <ThemedText>{t("taskPlanning.estimate")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskPlanning.estimate")}
        value={estimate}
        onChangeText={(v) => session.change("estimate", v)}
        editable={!locked}
        keyboardType="number-pad"
        maxLength={16}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("taskPlanning.revisionLimit")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskPlanning.revisionLimit")}
        value={revisionLimit}
        onChangeText={(v) => session.change("revisionLimit", v)}
        editable={!locked}
        keyboardType="number-pad"
        maxLength={16}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>
        {t("taskPlanning.revisionsUsed")}: {snapshot.revisionRoundsUsed}
      </ThemedText>
      <ThemedText>{t("taskPlanning.numberHelp")}</ThemedText>
      <TaskKindField
        crewId={snapshot.crewId}
        generation={generation}
        selected={taskKind}
        locked={locked}
        loadTemplates={false}
        onSelect={(v) => session.change("taskKind", v)}
      />
      <TaskPlanningFields
        crewId={snapshot.crewId}
        generation={generation}
        value={draft.fields}
        onChange={(v) => session.change("fields", v)}
        locked={locked}
      />
      <TaskCompensationFields
        reward={reward}
        share={share}
        onReward={(v) => session.change("reward", v)}
        onShare={(v) => session.change("share", v)}
        locked={locked}
      />
      <ThemedText>{t("taskPlanning.positionRole")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskPlanning.positionRole")}
        value={positionRole}
        onChangeText={(v) => session.change("positionRole", v)}
        maxLength={80}
        editable={!locked}
        style={{ color: theme.text, padding: 12 }}
      />
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {(error || stale) && (
        <Pressable
          accessibilityRole="button"
          disabled={session.busy}
          onPress={onRefresh}
          style={{ padding: 12 }}
        >
          <ThemedText>{t("thread.refresh")}</ThemedText>
        </Pressable>
      )}
      {canReview && (
        <View style={{ gap: 8 }}>
          <ThemedText>{t("taskPlanning.latest")}</ThemedText>
          <ThemedText>
            {t("taskPlanning.positionRole")}: {snapshot.positionRole ?? t("thread.taskUnset")}
          </ThemedText>
          <ThemedText>
            {t("taskPlanning.estimate")}: {snapshot.estimatePoints ?? t("thread.taskUnset")}
          </ThemedText>
          <ThemedText>
            {t("taskPlanning.revisionLimit")}: {snapshot.revisionLimit ?? t("thread.taskUnset")}
          </ThemedText>
          <ThemedText>
            {t("taskCompensation.reward")}:{" "}
            {compensationText(snapshot.rewardUsdMinor) || t("thread.taskUnset")}
          </ThemedText>
          <ThemedText>
            {t("taskCompensation.share")}:{" "}
            {compensationText(snapshot.profitShareBps) || t("thread.taskUnset")}
          </ThemedText>
          <ThemedText>
            {snapshot.taskKind ? t(`taskKind.${snapshot.taskKind}`) : t("taskKind.unset")}
          </ThemedText>
          <ThemedText>
            {t("taskPlanning.cycle")}: {snapshot.cycle?.name ?? t("thread.taskUnset")}
          </ThemedText>
          <ThemedText>
            {t("taskPlanning.episode")}: {snapshot.episode?.title ?? t("thread.taskUnset")}
          </ThemedText>
          <ThemedText>
            {t("taskPlanning.labels")}:{" "}
            {snapshot.labels.map((label) => label.name).join(", ") || t("thread.taskUnset")}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => session.review(snapshot)}
            style={{ padding: 12 }}
          >
            <ThemedText>{t("taskBrief.reviewLatest")}</ThemedText>
          </Pressable>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={!parsed?.success || locked || stale}
        style={{ padding: 12, opacity: !parsed?.success || locked || stale ? 0.45 : 1 }}
        onPress={() => {
          if (!stale) session.save(snapshot);
        }}
      >
        <ThemedText>{t("taskPlanning.save")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={session.busy}
        style={{ padding: 12 }}
        onPress={session.cancel}
      >
        <ThemedText>{t("myServices.cancel")}</ThemedText>
      </Pressable>
      {session.busy && <ActivityIndicator />}
    </View>
  );
}
