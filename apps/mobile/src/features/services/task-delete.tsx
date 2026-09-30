import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { deleteTask } from "./task-delete-api";
type Props = {
  task: { id: string; crewId: string; title: string; version: number };
  userId: string;
  generation: number;
  onDeleted: () => void;
  onRefresh: () => void;
};
export function TaskDelete(props: Props) {
  return <Session key={`${props.task.id}:${props.generation}`} {...props} />;
}
function Session({ task, userId, generation, onDeleted, onRefresh }: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(task.id, true);
  const [allowed, setAllowed] = useState<boolean>(),
    [error, setError] = useState<string>(),
    [snapshot, setSnapshot] = useState<Props["task"]>(),
    [attempted, setAttempted] = useState(false),
    [done, setDone] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    void fetchTaskCommentAccess(task.crewId, userId, c.signal).then(
      (a) => {
        if (!c.signal.aborted && generation === getAuthGeneration()) setAllowed(a.canManage);
      },
      (e) => {
        if (!c.signal.aborted && generation === getAuthGeneration())
          setError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => c.abort();
  }, [task.crewId, userId, generation]);
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || op.busy }}
      disabled={disabled || op.busy}
      onPress={onPress}
      style={{ padding: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.border }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  const stale = snapshot !== undefined && snapshot.version !== task.version;
  const submit = () => {
    if (!allowed || !snapshot || attempted || stale || generation !== getAuthGeneration()) return;
    void op.run(
      () => {
        setAttempted(true);
        setError(undefined);
        return deleteTask(snapshot, userId, generation);
      },
      () => {
        setDone(true);
        onDeleted();
      },
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  };
  if (allowed === false || done) return null;
  return (
    <View style={{ gap: 8 }}>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {op.busy && <ActivityIndicator />}
      {attempted && !op.busy ? (
        <>
          <ThemedText>{t("taskDelete.recheck")}</ThemedText>
          {button(t("thread.refresh"), onRefresh)}
        </>
      ) : (
        allowed &&
        !attempted &&
        (snapshot ? (
          <>
            <ThemedText>
              {t("taskDelete.confirmTitle").replace("{title}", snapshot.title)}
            </ThemedText>
            <ThemedText>{t("taskDelete.notice")}</ThemedText>
            {stale && <ThemedText accessibilityRole="alert">{t("taskClosure.stale")}</ThemedText>}
            {button(t("taskDelete.confirm"), submit, stale)}
            {button(t("common.cancel"), () => setSnapshot(undefined))}
          </>
        ) : (
          button(t("taskDelete.title"), () => setSnapshot({ ...task }))
        ))
      )}
      {allowed === undefined && error && button(t("thread.refresh"), onRefresh)}
    </View>
  );
}
