import { CrewCompute } from "./crew-compute";
import { TaskRequestHistory } from "./task-request-history";
import { PdfTaskImport } from "./pdf-task-import";
import { TaskBatch } from "./task-batch";
import { TaskDeadline } from "./task-deadline";
import { TaskDraftAssignees } from "./task-draft-assignees";
import { TaskCompensationSummary } from "./task-compensation-summary";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useLocale, useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { TaskCreate } from "./task-create";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { getTaskDraftSession } from "./task-draft-session";
import { AssetOrganization } from "../crew-assets/organization";
import { pendingAssetTasks } from "./asset-task-progress-api";
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
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const active = useScreenActive();
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const date = (value: string) =>
    new Date(value).toLocaleString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const [session] = useState(() =>
    getTaskDraftSession(props.crewId, props.userId, props.generation)
  );
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot
  );
  const [editing, setEditing] = useState<boolean | number>(false),
    [remove, setRemove] = useState<number>();
  const [accessRevision, setAccessRevision] = useState(0);
  const accessScope = useMemo(() => ({ active, accessRevision }), [active, accessRevision]);
  const [accessResult, setAccessResult] = useState<{
    scope: typeof accessScope;
    allowed?: boolean;
    canManage?: boolean;
    error?: string;
  }>();
  const allowed = accessResult?.scope === accessScope ? accessResult.allowed : undefined;
  const error = accessResult?.scope === accessScope ? accessResult.error : undefined;
  const [section, setSection] = useState<
    | "compute"
    | "assets"
    | "progress"
    | "episodes"
    | "template"
    | "canvas"
    | "pdf"
    | "assign"
    | "recruit"
  >();
  const alive = useRef(false);
  const foreground = useRef(0);
  useEffect(() => {
    foreground.current += 1;
    alive.current = active;
    if (!active) return;
    const c = new AbortController();
    void fetchTaskCommentAccess(props.crewId, props.userId, c.signal).then(
      (access) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setAccessResult({
            scope: accessScope,
            allowed: access.canSubmit,
            canManage: access.canManage,
          });
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setAccessResult({
            scope: accessScope,
            error: cause instanceof Error ? cause.message : String(cause),
          });
      }
    );
    return () => {
      alive.current = false;
      c.abort();
    };
  }, [props.crewId, props.userId, props.generation, active, accessScope]);
  // Keep the draft session mounted while inspecting source assets or episodes.
  // Each destination checks its own read/write permissions independently.
  if (section) {
    const childProps = { ...props, onClose: () => setSection(undefined) };
    if (section === "compute") return <CrewCompute {...childProps} requestFirst />;
    if (section === "pdf") return <PdfTaskImport {...childProps} />;
    if (section === "assign" || section === "recruit")
      return <TaskBatch {...childProps} mode={section} />;
    if (section === "assets") return <AssetOrganization {...childProps} />;
    if (section === "progress")
      return <AssetTaskProgress {...childProps} pending={pendingAssetTasks(snapshot.drafts)} />;
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
  const editingDraft =
    typeof editing === "number"
      ? snapshot.drafts.find((row) => row.id === editing && row.kind === "task")
      : undefined;
  // Retain unstaged editor state while foreground permissions are refreshed.
  // Only a fresh authorization may expose its controls; revocation retires it.
  if (editing && allowed !== false)
    return (
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1, display: allowed ? "flex" : "none" }}>
          <TaskCreate
            {...props}
            suspended={!allowed}
            initialDraft={editingDraft?.kind === "task" ? editingDraft : undefined}
            closeLabel={t("taskWorkbench.title")}
            onClose={() => setEditing(false)}
            onStage={(input, review) => {
              if (typeof editing === "number") session.edit(editing, input, review);
              else session.stage(input, review);
              setEditing(false);
            }}
          />
        </View>
        {active && !allowed && (
          <View style={{ padding: 16, gap: 12 }}>
            {error ? (
              <>
                <ThemedText accessibilityRole="alert">{error}</ThemedText>
                <Button
                  label={t("inbox.retry")}
                  onPress={() => setAccessRevision((value) => value + 1)}
                />
              </>
            ) : (
              <ActivityIndicator />
            )}
            <Button label={t("taskWorkbench.title")} onPress={() => setEditing(false)} />
          </View>
        )}
      </View>
    );
  if (!active) return null;
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
      <Button label={t("taskWorkbench.applyPoints")} onPress={() => setSection("compute")} />
      {snapshot.storageError && (
        <View style={{ gap: 8 }}>
          <ThemedText accessibilityRole="alert">
            {t("taskWorkbench.storageError")}: {snapshot.storageError}
          </ThemedText>
          <Button
            label={t("inbox.retry")}
            disabled={snapshot.busy}
            onPress={() => {
              session.save();
            }}
          />
        </View>
      )}
      <View
        style={{ padding: 12, gap: 8, borderRadius: 8, backgroundColor: theme.backgroundElement }}
      >
        <ThemedText type="smallBold">{t("taskWorkbench.assetLibrary")}</ThemedText>
        <Button
          label={t("assetOrganization.title")}
          disabled={snapshot.busy || !!snapshot.storageError}
          onPress={() => setSection("assets")}
        />
        <Button
          label={t("assetTaskProgress.title")}
          disabled={snapshot.busy || !!snapshot.storageError}
          onPress={() => setSection("progress")}
        />
        <Button
          label={t("episodeManagement.title")}
          disabled={snapshot.busy || !!snapshot.storageError}
          onPress={() => setSection("episodes")}
        />
      </View>
      <TaskRequestHistory crewId={props.crewId} generation={props.generation} />
      {allowed === undefined && !error && <ActivityIndicator />}
      {(error || allowed === false) && (
        <ThemedText accessibilityRole="alert">{error ?? t("taskCreate.managerOnly")}</ThemedText>
      )}
      {error && (
        <Button label={t("inbox.retry")} onPress={() => setAccessRevision((value) => value + 1)} />
      )}
      {allowed && (
        <>
          <Button
            label={t("taskCreate.title")}
            disabled={snapshot.busy || !!snapshot.storageError}
            onPress={() => setEditing(true)}
          />
          <Button
            label={t("episodeTaskTemplate.title")}
            disabled={snapshot.busy || !!snapshot.storageError}
            onPress={() => setSection("template")}
          />
          <Button
            label={t("canvasImport.title")}
            disabled={snapshot.busy || !!snapshot.storageError}
            onPress={() => setSection("canvas")}
          />
          <Button
            label={t("mobileProduction.pdfTitle")}
            disabled={snapshot.busy}
            onPress={() => setSection("pdf")}
          />
          <Button
            label={t("mobileProduction.batchAssign")}
            disabled={snapshot.busy || !accessResult?.canManage}
            onPress={() => setSection("assign")}
          />
          <Button
            label={t("mobileProduction.batchRecruit")}
            disabled={snapshot.busy || !accessResult?.canManage}
            onPress={() => setSection("recruit")}
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
                      {t("thread.taskStart")}: {date(row.input.startAt)}
                    </ThemedText>
                  )}
                  {row.input.dueAt && (
                    <ThemedText>
                      {t("thread.taskDue")}: {date(row.input.dueAt)}
                      {row.state === "staged" && (
                        <TaskDeadline dueAt={row.input.dueAt} status="draft" />
                      )}
                    </ThemedText>
                  )}
                  <TaskCompensationSummary {...row.input} />
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
                  <TaskDraftAssignees
                    owner={String(props.generation)}
                    userIds={row.input.assignees.map((assignee) => assignee.userId)}
                    labels={row.review.assignees}
                  />
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
                    <View key={item.templateKey} style={{ gap: 4 }}>
                      <ThemedText>{item.title}</ThemedText>
                      {row.plan.fieldReview?.[item.templateKey]?.map((value, index) => (
                        <ThemedText key={index}>{value}</ThemedText>
                      ))}
                    </View>
                  ))}
                </>
              )}
              <ThemedText>{t(`taskWorkbench.${row.state}`)}</ThemedText>
              {row.taskIds?.map((id, index) => (
                <Button
                  key={id}
                  label={`${t("taskWorkbench.open")} ${index + 1}`}
                  disabled={snapshot.busy || !!snapshot.storageError}
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
              {row.state === "staged" && row.kind === "task" && (
                <Button
                  label={t("taskWorkbench.editDraft")}
                  disabled={snapshot.busy || !!snapshot.storageError}
                  onPress={() => setEditing(row.id)}
                />
              )}
              {row.state === "staged" && (
                <Button
                  label={t("taskWorkbench.remove")}
                  disabled={snapshot.busy || !!snapshot.storageError}
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
                    disabled={snapshot.busy || !!snapshot.storageError}
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
          {snapshot.drafts.some((row) => row.state !== "created") && (
            <Button
              primary
              label={t("taskWorkbench.createAll")}
              disabled={snapshot.busy || !staged || uncertain || !!snapshot.storageError}
              onPress={() => {
                const startedIn = foreground.current;
                void session.createAll(() => alive.current && foreground.current === startedIn);
              }}
            />
          )}
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
