import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { TaskCreate } from "./task-create";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { getTaskDraftSession } from "./task-draft-session";
import { AssetOrganization } from "../crew-assets/organization";
import { AssetTaskProgress } from "./asset-task-progress";
import { EpisodeTaskTemplate } from "./episode-task-template";
import { CanvasTaskImport } from "./canvas-task-import";
import { canvasScenes } from "./canvas-task-import-api";
import { EpisodeManagement } from "./episode-management";
type Props = {
  viewId?: string;
  crewId: string;
  userId: string;
  generation: number;
  onClose: () => void;
  onCreated: (id: string) => void;
};
export function TaskWorkbench(props: Props) {
  const active = useScreenActive();
  return active && props.generation === getAuthGeneration() ? (
    <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations(),
    theme = useTheme();
  const [session] = useState(() =>
    getTaskDraftSession(props.crewId, props.userId, props.generation)
  );
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot
  );
  const [editing, setEditing] = useState(false),
    [allowed, setAllowed] = useState<boolean>(),
    [error, setError] = useState<string>(),
    [remove, setRemove] = useState<number>();
  const [section, setSection] = useState<
    "assets" | "progress" | "episodes" | "template" | "canvas"
  >();
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    const c = new AbortController();
    void fetchTaskCommentAccess(props.crewId, props.userId, c.signal).then(
      (access) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setAllowed(access.canManage);
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => {
      alive.current = false;
      c.abort();
    };
  }, [props.crewId, props.userId, props.generation]);
  // Keep the draft session mounted while inspecting source assets or episodes.
  // Each destination checks its own read/write permissions independently.
  if (section) {
    const childProps = { ...props, onClose: () => setSection(undefined) };
    if (section === "assets") return <AssetOrganization {...childProps} />;
    if (section === "progress") return <AssetTaskProgress {...childProps} />;
    if (section === "canvas")
      return (
        <CanvasTaskImport
          {...childProps}
          onStage={(preview) => {
            if (!session.stageCanvas(preview)) throw new Error(t("canvasImport.queued"));
            setSection(undefined);
          }}
        />
      );
    if (section === "template")
      return (
        <EpisodeTaskTemplate
          {...childProps}
          onStage={(episode, plan) => {
            if (!session.stageEpisode(episode.id, episode.name, plan))
              throw new Error(t("taskWorkbench.episodeQueued"));
            setSection(undefined);
          }}
        />
      );
    return <EpisodeManagement {...childProps} />;
  }
  if (editing && allowed)
    return (
      <TaskCreate
        {...props}
        closeLabel={t("taskWorkbench.title")}
        onClose={() => setEditing(false)}
        onStage={(input, review) => {
          session.stage(input, review);
          setEditing(false);
        }}
      />
    );
  const staged = snapshot.drafts
    .filter((row) => row.state === "staged")
    .reduce(
      (count, row) =>
        count +
        (row.kind === "episode"
          ? row.plan.items.length
          : row.kind === "canvas"
            ? canvasScenes(row.preview).length
            : 1),
      0
    );
  const uncertain = snapshot.drafts.some((row) => row.state === "uncertain");
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("taskWorkbench.title")}</ThemedText>
      <ThemedText>{t("taskWorkbench.help")}</ThemedText>
      <View
        style={{ padding: 12, gap: 8, borderRadius: 8, backgroundColor: theme.backgroundElement }}
      >
        <ThemedText type="smallBold">{t("taskWorkbench.assetLibrary")}</ThemedText>
        <Button
          label={t("assetOrganization.title")}
          disabled={snapshot.busy}
          onPress={() => setSection("assets")}
        />
        <Button
          label={t("assetTaskProgress.title")}
          disabled={snapshot.busy}
          onPress={() => setSection("progress")}
        />
        <Button
          label={t("episodeManagement.title")}
          disabled={snapshot.busy}
          onPress={() => setSection("episodes")}
        />
      </View>
      {allowed === undefined && !error && <ActivityIndicator />}
      {(error || allowed === false) && (
        <ThemedText accessibilityRole="alert">{error ?? t("taskCreate.managerOnly")}</ThemedText>
      )}
      {allowed && (
        <>
          <Button
            label={t("taskCreate.title")}
            disabled={snapshot.busy}
            onPress={() => setEditing(true)}
          />
          <Button
            label={t("episodeTaskTemplate.title")}
            disabled={snapshot.busy}
            onPress={() => setSection("template")}
          />
          <Button
            label={t("canvasImport.title")}
            disabled={snapshot.busy}
            onPress={() => setSection("canvas")}
          />
          <ThemedText>{t("taskWorkbench.count").replace("{count}", String(staged))}</ThemedText>
          {snapshot.drafts.map((row) => (
            <View
              key={row.id}
              style={{
                padding: 12,
                gap: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: theme.border,
              }}
            >
              {row.kind === "task" ? (
                <>
                  <ThemedText type="smallBold">{row.input.title}</ThemedText>
                  <ThemedText>{row.input.description}</ThemedText>
                  <ThemedText>
                    {t("taskKind.label")}:{" "}
                    {t(row.input.taskKind ? `taskKind.${row.input.taskKind}` : "taskKind.unset")}
                  </ThemedText>
                  <ThemedText>
                    {t("taskSchedule.priority")}: {t(`taskSchedule.${row.input.priority}`)}
                  </ThemedText>
                  {row.input.startAt && (
                    <ThemedText>
                      {t("thread.taskStart")}: {row.input.startAt}
                    </ThemedText>
                  )}
                  {row.input.dueAt && (
                    <ThemedText>
                      {t("thread.taskDue")}: {row.input.dueAt}
                    </ThemedText>
                  )}
                  {row.input.estimatePoints != null && (
                    <ThemedText>
                      {t("taskPlanning.estimate")}: {row.input.estimatePoints}
                    </ThemedText>
                  )}
                  {row.input.revisionLimit != null && (
                    <ThemedText>
                      {t("taskPlanning.revisionLimit")}: {row.input.revisionLimit}
                    </ThemedText>
                  )}
                  {row.review.context.map((value, i) => (
                    <ThemedText key={`context:${i}`}>{value}</ThemedText>
                  ))}
                  <ThemedText>
                    {t("taskCreate.assignees")}:{" "}
                    {row.review.assignees.join(", ") || t("thread.taskUnset")}
                  </ThemedText>
                  {row.review.customFields.map((value, i) => (
                    <ThemedText key={`field:${i}`}>{value}</ThemedText>
                  ))}
                </>
              ) : row.kind === "canvas" ? (
                <>
                  <ThemedText type="smallBold">{row.preview.title}</ThemedText>
                  {canvasScenes(row.preview).map((scene) => (
                    <ThemedText key={scene.id}>{scene.content.title || scene.id}</ThemedText>
                  ))}
                </>
              ) : (
                <>
                  <ThemedText type="smallBold">{row.title}</ThemedText>
                  <ThemedText>{row.plan.name}</ThemedText>
                  {row.plan.items.map((item) => (
                    <ThemedText key={item.templateKey}>{item.title}</ThemedText>
                  ))}
                </>
              )}
              <ThemedText>{t(`taskWorkbench.${row.state}`)}</ThemedText>
              {row.taskIds?.map((id, index) => (
                <Button
                  key={id}
                  label={`${t("taskWorkbench.open")} ${index + 1}`}
                  disabled={snapshot.busy}
                  onPress={() => props.onCreated(id)}
                />
              ))}
              {row.error && <ThemedText accessibilityRole="alert">{row.error}</ThemedText>}
              {row.kind !== "task" && row.error && (
                <ThemedText>{t("taskWorkbench.episodeRetry")}</ThemedText>
              )}
              {row.taskId && (
                <Button
                  label={t("taskWorkbench.open")}
                  disabled={snapshot.busy}
                  onPress={() => props.onCreated(row.taskId!)}
                />
              )}
              {row.state === "staged" && (
                <Button
                  label={t("taskWorkbench.remove")}
                  disabled={snapshot.busy}
                  onPress={() => session.remove(row.id)}
                />
              )}
              {row.state === "uncertain" && (
                <>
                  <ThemedText>{t("taskCreate.uncertain")}</ThemedText>
                  {remove === row.id && <ThemedText>{t("taskWorkbench.forgetHelp")}</ThemedText>}
                  <Button
                    label={t(
                      remove === row.id ? "taskWorkbench.confirmForget" : "taskWorkbench.forget"
                    )}
                    disabled={snapshot.busy}
                    onPress={() => {
                      if (remove !== row.id) setRemove(row.id);
                      else {
                        session.remove(row.id);
                        setRemove(undefined);
                      }
                    }}
                  />
                </>
              )}
            </View>
          ))}
          {snapshot.error && <ThemedText accessibilityRole="alert">{snapshot.error}</ThemedText>}
          <Button
            primary
            label={t("taskWorkbench.createAll")}
            disabled={snapshot.busy || !staged || uncertain}
            onPress={() => void session.createAll(() => alive.current)}
          />
          {snapshot.busy && <ActivityIndicator />}
        </>
      )}
      <Button label={t("crewTasks.back")} disabled={snapshot.busy} onPress={props.onClose} />
    </ScrollView>
  );
}
function Button({
  label,
  onPress,
  disabled,
  primary,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ disabled: !!disabled }}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: primary ? theme.brand : theme.backgroundElement,
        opacity: disabled ? 0.5 : 1,
      }}
      onPress={onPress}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
