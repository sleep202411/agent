import { useEffect, useState } from "react";
import { uuid } from "expo-modules-core";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { closeTask, taskClosureInput, type TaskClosureInput } from "./task-closure-api";
import type { TaskDetail } from "./task-detail-api";
type Props = { task: TaskDetail; userId: string; generation: number; onRefresh: () => void };
export function TaskClosure(props: Props) {
  return <Session key={`${props.task.id}:${props.generation}`} {...props} />;
}
function Session({ task, userId, generation, onRefresh }: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(task.id, true);
  const [allowed, setAllowed] = useState<boolean>(),
    [error, setError] = useState<string>(),
    [open, setOpen] = useState(false),
    [version, setVersion] = useState<number>(),
    [reason, setReason] = useState(""),
    [retry, setRetry] = useState<TaskClosureInput>(),
    [done, setDone] = useState(false),
    [rejected, setRejected] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    void fetchTaskCommentAccess(task.crewId, userId, c.signal).then(
      (access) => {
        if (!c.signal.aborted && generation === getAuthGeneration()) setAllowed(access.canManage);
      },
      (cause) => {
        if (!c.signal.aborted && generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => c.abort();
  }, [task.crewId, userId, generation]);
  const eligible = !["submitted", "approved", "cancelled"].includes(task.status),
    stale = version !== undefined && version !== task.version;
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || op.busy }}
      disabled={disabled || op.busy}
      onPress={onPress}
      style={{ padding: 12, borderWidth: 1, borderColor: theme.border, borderRadius: 8 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  const submit = () => {
    if (
      !allowed ||
      done ||
      rejected ||
      generation !== getAuthGeneration() ||
      (!retry && (!eligible || stale))
    )
      return;
    const parsed = taskClosureInput.safeParse(
      retry ?? { requestId: uuid.v4(), expectedVersion: version ?? task.version, reason }
    );
    if (!parsed.success) {
      setError(t("taskClosure.required"));
      return;
    }
    const body = parsed.data;
    void op.run(
      () => {
        setError(undefined);
        return closeTask(task, userId, generation, body);
      },
      () => {
        setDone(true);
        setRetry(undefined);
      },
      (cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        const status =
          cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : 0;
        if ([400, 401, 403, 404, 409, 422].includes(status)) {
          setRetry(undefined);
          setRejected(true);
        } else setRetry(body);
      }
    );
  };
  if (allowed === false || (!eligible && !retry && !done)) return null;
  return (
    <View style={{ gap: 8 }}>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {allowed === undefined && !error && <ActivityIndicator />}
      {done ? (
        <>
          <ThemedText>{t("taskClosure.done")}</ThemedText>
          {button(t("thread.refresh"), onRefresh)}
        </>
      ) : rejected ? (
        button(t("thread.refresh"), onRefresh)
      ) : (
        allowed &&
        (!open ? (
          button(t("taskClosure.title"), () => {
            setVersion(task.version);
            setOpen(true);
          })
        ) : (
          <>
            <ThemedText>{t("taskClosure.notice")}</ThemedText>
            {retry ? (
              <ThemedText>{t("taskClosure.retryHelp")}</ThemedText>
            ) : (
              <>
                <ThemedText>{t("taskClosure.reason")}</ThemedText>
                <TextInput
                  accessibilityLabel={t("taskClosure.reason")}
                  value={reason}
                  onChangeText={setReason}
                  editable={!op.busy}
                  multiline
                  maxLength={4000}
                  style={{
                    color: theme.text,
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 8,
                    padding: 12,
                    minHeight: 90,
                  }}
                />
                {stale && (
                  <ThemedText accessibilityRole="alert">{t("taskClosure.stale")}</ThemedText>
                )}
              </>
            )}
            {button(
              t(retry ? "taskClosure.retry" : "taskClosure.confirm"),
              submit,
              !retry && (stale || !reason.trim() || !eligible)
            )}
            {!retry &&
              button(t("common.cancel"), () => {
                setReason("");
                setError(undefined);
                setOpen(false);
                setVersion(undefined);
              })}
          </>
        ))
      )}
      {op.busy && <ActivityIndicator />}
      {allowed === undefined && error && button(t("thread.refresh"), onRefresh)}
    </View>
  );
}
