import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import {
  fetchTaskContracts,
  attachTaskContract,
  type TaskContractFile,
} from "./task-contract-files-api";
import { taskContractPending } from "./task-contract-pending";
import { TaskContractField } from "./task-contract-field";
import { ContractFileRow } from "./contract-file-row";
type Props = { taskId: string; crewId: string; userId: string; generation: number };
export function TaskContractFiles(props: Props) {
  const active = useScreenActive();
  const [retry, setRetry] = useState(0);
  return active && props.generation === getAuthGeneration() ? (
    <ContractSession
      key={JSON.stringify([props.taskId, props.crewId, props.userId, props.generation, retry])}
      {...props}
      onRetryStorage={() => setRetry((v) => v + 1)}
    />
  ) : null;
}
function ContractSession({
  taskId,
  crewId,
  userId,
  generation,
  onRetryStorage,
}: Props & { onRetryStorage: () => void }) {
  const t = useTranslations();
  const [store] = useState(() => taskContractPending(taskId, userId, generation));
  const [initial] = useState(() => {
    try {
      return { pending: store.read(), error: "" };
    } catch (cause) {
      return { pending: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  const [pending, setPending] = useState(initial.pending);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    revision: number;
    files?: TaskContractFile[];
    allowed?: boolean;
    error?: string;
  }>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(initial.error);
  const controller = useRef<AbortController | null>(null),
    inFlight = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void Promise.all([
      fetchTaskContracts(taskId, generation, c.signal),
      fetchTaskCommentAccess(crewId, userId, c.signal),
    ])
      .then(([files, access]) => {
        if (!c.signal.aborted && generation === getAuthGeneration())
          setResult({ revision, files, allowed: access.canManage });
      })
      .catch((cause: unknown) => {
        if (!c.signal.aborted && generation === getAuthGeneration())
          setResult({ revision, error: cause instanceof Error ? cause.message : String(cause) });
      });
    return () => {
      c.abort();
      controller.current = null;
    };
  }, [taskId, crewId, userId, generation, revision]);
  const current = result?.revision === revision ? result : undefined;
  async function attach() {
    const c = controller.current;
    if (
      !pending ||
      !current?.allowed ||
      !c ||
      c.signal.aborted ||
      inFlight.current ||
      initial.error
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const request = { ...pending, attempted: true };
      store.save(request);
      setPending(request);
      await attachTaskContract(crewId, taskId, userId, generation, request.assetNodeId, c.signal);
      store.clear(request.assetNodeId, true);
      if (!c.signal.aborted && generation === getAuthGeneration()) {
        setPending(null);
        setRevision((v) => v + 1);
      }
    } catch (cause) {
      if (!c.signal.aborted && generation === getAuthGeneration())
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 8, paddingVertical: 12 }}>
      <ThemedText type="smallBold">{t("taskContractFiles.title")}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t("taskContractFiles.lockedHint")}
      </ThemedText>
      {!current && <ActivityIndicator />}
      {!!current?.error && <ThemedText accessibilityRole="alert">{current.error}</ThemedText>}
      <Pressable
        accessibilityRole="button"
        disabled={busy || !current}
        onPress={() => setRevision((v) => v + 1)}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <ThemedText>{t(current?.error ? "taskContractFiles.retry" : "thread.refresh")}</ThemedText>
      </Pressable>
      {current?.files?.map((file) => (
        <ContractFileRow key={file.id} file={file} generation={generation} />
      ))}
      {current?.files?.length === 0 && <ThemedText>{t("taskContractFiles.empty")}</ThemedText>}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {!!initial.error && (
        <Pressable
          accessibilityRole="button"
          onPress={onRetryStorage}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <ThemedText>{t("common.retry")}</ThemedText>
        </Pressable>
      )}
      {current?.allowed && current.files && !initial.error && (
        <>
          <TaskContractField
            crewId={crewId}
            userId={userId}
            generation={generation}
            value={pending?.assetNodeId ?? null}
            locked={busy || !!pending?.attempted}
            onChange={(assetNodeId) => {
              try {
                if (pending && pending.assetNodeId !== assetNodeId)
                  store.clear(pending.assetNodeId);
                const next = assetNodeId ? { assetNodeId, attempted: false } : null;
                if (next) store.save(next);
                setPending(next);
                setError("");
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
                throw cause; // Keep the upload receipt until its selection is durably recorded.
              }
            }}
          />
          {!!pending && (
            <>
              <ThemedText type="small">{t("taskContractFiles.attachNotice")}</ThemedText>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void attach()}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <ThemedText>
                  {t(
                    pending.attempted ? "taskContractFiles.retryAttach" : "taskContractFiles.attach"
                  )}
                </ThemedText>
              </Pressable>
            </>
          )}
        </>
      )}
    </View>
  );
}
