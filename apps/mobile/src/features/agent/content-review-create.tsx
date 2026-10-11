import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { uuid } from "expo-modules-core";
import { useAuth } from "@/auth/use-auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations, type MessageKey } from "@/i18n";
import { fetchWorkspaceSettings } from "./api/studio-workspace-settings-api";
import { contentReviewWorkflow, type ReviewWorkflow } from "./content-review-workflow";
import { pickReviewVideo } from "./pick-review-video";

type Props = { workspaceId: string; generation: number; onOpen: (id: string) => void };
export function ContentReviewCreate(props: Props) {
  const auth = useAuth();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  if (auth.status !== "authenticated" || !userId || auth.generation !== props.generation)
    return null;
  return (
    <Creation
      key={`${userId}:${props.workspaceId}:${props.generation}`}
      {...props}
      userId={userId}
    />
  );
}
function Creation({ workspaceId, generation, userId, onOpen }: Props & { userId: string }) {
  const t = useTranslations(),
    theme = useTheme();
  const label = (key: string) => t(`contentReviewCreate.${key}` as MessageKey);
  const workflow = useMemo(
    () => contentReviewWorkflow(userId, workspaceId, generation),
    [userId, workspaceId, generation]
  );
  const [allowed, setAllowed] = useState(false),
    [job, setJob] = useState<ReviewWorkflow | null>(null),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<number>();
  const [hasSource, setHasSource] = useState(false);
  const source = useRef<Awaited<ReturnType<typeof pickReviewVideo>>>(null);
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void fetchWorkspaceSettings(workspaceId, generation, controller.signal)
      .then((workspace) => {
        if (controller.signal.aborted || generation !== getAuthGeneration()) return;
        const canCreate =
          workspace.status === "active" &&
          workspace.accessScope === "workspace" &&
          ["owner", "admin", "editor"].includes(workspace.role ?? "");
        setAllowed(canCreate);
        if (canCreate) setJob(workflow.read());
      })
      .catch((cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setError(String(cause instanceof Error ? cause.message : cause));
      });
    return () => {
      mounted.current = false;
      controller.abort();
      operation.current?.abort();
      source.current = null;
    };
  }, [workspaceId, generation, workflow]);
  async function act(kind: "select" | "run" | "refund") {
    if (operation.current || !allowed || generation !== getAuthGeneration()) return;
    const controller = new AbortController();
    operation.current = controller;
    const current = () =>
      mounted.current && !controller.signal.aborted && generation === getAuthGeneration();
    setBusy(true);
    setError(undefined);
    setProgress(undefined);
    try {
      if (kind === "select") {
        const selected = await pickReviewVideo(controller.signal);
        if (!selected || !current()) return;
        const existing = workflow.read();
        if (existing && !["saved", "refunded"].includes(existing.phase)) {
          if (
            selected.source.name !== existing.file.name ||
            selected.source.size !== existing.file.size ||
            selected.source.contentType !== existing.file.contentType ||
            selected.durationSeconds !== existing.durationSeconds
          )
            throw new Error(label("originalMismatch"));
        } else {
          await workflow.begin(
            { chargeId: uuid.v4(), uploadId: uuid.v4() },
            selected.source,
            selected.durationSeconds
          );
        }
        if (current()) {
          source.current = selected;
          setHasSource(true);
        }
      } else if (kind === "refund") {
        if (!job) return;
        await workflow.refund(controller.signal, job.id);
        if (current()) {
          source.current = null;
          setHasSource(false);
        }
      } else {
        if (!job) return;
        const deadline = Date.now() + 30 * 60_000;
        while (current()) {
          const next = await workflow.run(
            controller.signal,
            job.id,
            source.current?.source,
            (percent) => {
              if (current()) setProgress(percent);
            }
          );
          if (!current()) return;
          setJob(next);
          if (next.phase !== "reviewing") {
            source.current = null;
            setHasSource(false);
            break;
          }
          if (Date.now() >= deadline) {
            setError(label("pollTimeout"));
            break;
          }
          await waitForPoll(controller.signal);
        }
      }
    } catch (cause) {
      if (current()) {
        setError(cause instanceof Error ? cause.message : String(cause));
        const status =
          cause && typeof cause === "object" && "status" in cause ? cause.status : undefined;
        if (status === 401 || status === 403) {
          setAllowed(false);
          setJob(null);
          source.current = null;
        }
      }
    } finally {
      if (mounted.current && generation === getAuthGeneration()) {
        // Reload persisted intent even after a stopped request: its receipt may be unknown.
        try {
          const latest = workflow.read();
          setJob(latest);
          if (kind !== "select" && latest?.id !== job?.id) {
            source.current = null;
            setHasSource(false);
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
        setBusy(false);
      }
      if (operation.current === controller) operation.current = null;
    }
  }
  if (!allowed) return error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null;
  const needsFile = !!job && ["ready", "charging", "charged"].includes(job.phase);
  const terminal = !job || ["saved", "refunded"].includes(job.phase);
  return (
    <View
      style={{ padding: 12, gap: 8, borderRadius: 8, backgroundColor: theme.backgroundElement }}
    >
      <ThemedText type="smallBold">{label("title")}</ThemedText>
      <ThemedText type="small">{label("limits")}</ThemedText>
      {job && (
        <>
          <ThemedText>{job.file.name}</ThemedText>
          <ThemedText type="small">
            {label("quote")}: {job.credits} · {job.durationSeconds}s
          </ThemedText>
          <ThemedText type="small">{label(`phase.${job.phase}`)}</ThemedText>
          {job.failure && <ThemedText accessibilityRole="alert">{job.failure}</ThemedText>}
          {job.phase === "submitting" && (
            <View>
              <ThemedText>{label("unknown")}</ThemedText>
              <ThemedText selectable>{job.id}</ThemedText>
            </View>
          )}
          {job.phase === "saved" && job.recordId && (
            <Action title={label("open")} disabled={busy} onPress={() => onOpen(job.recordId!)} />
          )}
        </>
      )}
      {(terminal || needsFile) && (
        <Action
          title={label(terminal ? "select" : "reselect")}
          disabled={busy}
          onPress={() => void act("select")}
        />
      )}
      {job && !terminal && !["submitting", "failed", "refunding"].includes(job.phase) && (
        <>
          {job.phase === "ready" && <ThemedText type="small">{label("chargeNotice")}</ThemedText>}
          {
            <Action
              title={label(job.phase === "ready" ? "confirm" : "resume")}
              disabled={busy || (needsFile && !hasSource)}
              onPress={() => void act("run")}
            />
          }
        </>
      )}
      {job &&
        ["ready", "charging", "charged", "uploaded", "failed", "refunding"].includes(job.phase) && (
          <Action
            title={label(job.phase === "ready" ? "discard" : "refund")}
            disabled={busy}
            onPress={() => void act("refund")}
          />
        )}
      {busy && (
        <>
          <ActivityIndicator />
          {progress !== undefined && <ThemedText>{progress}%</ThemedText>}
          {<Action title={label("stop")} onPress={() => operation.current?.abort()} />}
        </>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    </View>
  );
}
function waitForPoll(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 5000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

function Action({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ padding: 12 }}
    >
      <ThemedText>{title}</ThemedText>
    </Pressable>
  );
}
