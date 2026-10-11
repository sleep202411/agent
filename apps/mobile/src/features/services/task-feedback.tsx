import { useEffect, useRef, useState } from "react";
import { uuid } from "expo-modules-core";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { PrivateCases } from "./private-cases";
import {
  fetchTaskFeedback,
  feedbackOutbox,
  writeTaskFeedback,
  type TaskFeedback,
  type FeedbackCommand,
} from "./task-feedback-api";
type Props = { userId: string; generation: number };
export function TaskFeedbackHistory(props: Props) {
  const active = useScreenActive();
  return active && props.generation === getAuthGeneration() ? (
    <History key={`${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function History(props: Props) {
  const t = useTranslations(),
    locale = useLocale();
  const loadedPages = useRef(new Set<string | null>());
  const [rows, setRows] = useState<TaskFeedback[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string>(),
    [web, setWeb] = useState<string>();
  useEffect(() => {
    if (web) return;
    const c = new AbortController();
    let busy = true;
    void fetchTaskFeedback(props.userId, props.generation, cursor, c.signal)
      .then((page) => {
        if (c.signal.aborted) return;
        if (!cursor) loadedPages.current.clear();
        loadedPages.current.add(cursor);
        setRows((old) =>
          cursor
            ? [...new Map([...old, ...page.items].map((row) => [row.id, row])).values()]
            : page.items
        );
        setNext(page.nextCursor);
      })
      .catch((cause) => {
        if (!c.signal.aborted) {
          setRows([]);
          setNext(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        busy = false;
        if (!c.signal.aborted) setLoading(false);
      });
    const timer = setInterval(async () => {
      if (busy || c.signal.aborted) return;
      busy = true;
      const fresh: TaskFeedback[] = [];
      const seen = new Set<string>();
      const pageLimit = Math.max(1, loadedPages.current.size);
      let pageCursor: string | null = null;
      try {
        // Refresh every loaded page atomically. Stable row keys preserve response
        // and appeal drafts while current permissions and responses are checked.
        while (true) {
          const page = await fetchTaskFeedback(
            props.userId,
            props.generation,
            pageCursor,
            c.signal
          );
          if (c.signal.aborted) return;
          fresh.push(...page.items);
          if (!page.nextCursor || seen.size + 1 >= pageLimit) {
            setRows([...new Map(fresh.map((row) => [row.id, row])).values()]);
            setNext(page.nextCursor);
            setError(undefined);
            break;
          }
          if (seen.has(page.nextCursor)) throw new Error("Feedback pagination did not advance");
          seen.add(page.nextCursor);
          pageCursor = page.nextCursor;
        }
      } catch (cause) {
        if (!c.signal.aborted) {
          setRows([]);
          setNext(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        busy = false;
      }
    }, 30_000);
    return () => {
      clearInterval(timer);
      c.abort();
    };
  }, [props.userId, props.generation, cursor, revision, web]);
  const refresh = () => {
    setLoading(true);
    setError(undefined);
    setRows([]);
    setCursor(null);
    setRevision((v) => v + 1);
  };
  if (web)
    return (
      <View style={{ flex: 1 }}>
        <Action label={t("feedbackHistory.back")} onPress={() => setWeb(undefined)} />
        <PrivateCases {...props} initialCaseId={web.split("/")[3]} />
      </View>
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("feedbackHistory.privacy")}</ThemedText>
      <Action label={t("thread.refresh")} onPress={refresh} disabled={loading} />
      <Action label={t("feedbackHistory.cases")} onPress={() => setWeb("/crews/cases")} />
      {loading && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {!loading && !error && !rows.length && <ThemedText>{t("feedbackHistory.empty")}</ThemedText>}
      {rows.map((row) => (
        <View key={row.id} style={{ gap: 8, paddingVertical: 12 }}>
          <ThemedText type="smallBold">
            {t("feedbackHistory.task")} {row.taskId}
          </ThemedText>
          <ThemedText>
            {row.authorUserId} → {row.subjectUserId}
          </ThemedText>
          <ThemedText>{new Date(row.createdAt).toLocaleString(locale)}</ThemedText>
          {(row.ratings.direction === "manager"
            ? [["managementAbility", row.ratings.managementAbility] as const]
            : [
                ["productionAbility", row.ratings.productionAbility] as const,
                ["understanding", row.ratings.understanding] as const,
                ["communication", row.ratings.communication] as const,
              ]
          ).map(([key, value]) => (
            <ThemedText key={key}>
              {t(`feedbackHistory.${key}`)}: {value} / 5
            </ThemedText>
          ))}
          <ThemedText selectable>{row.comment}</ThemedText>
          {row.response !== null && (
            <>
              <ThemedText type="smallBold">{t("feedbackHistory.response")}</ThemedText>
              <ThemedText selectable>{row.response}</ThemedText>
              {row.respondedAt && (
                <ThemedText>{new Date(row.respondedAt).toLocaleString(locale)}</ThemedText>
              )}
            </>
          )}
          {row.subjectUserId === props.userId && (
            <>
              {row.response === null && (
                <FeedbackWrite {...props} row={row} kind="response" onCase={setWeb} />
              )}
              <FeedbackWrite {...props} row={row} kind="appeal" onCase={setWeb} />
            </>
          )}
        </View>
      ))}
      {next && (
        <Action
          label={t("crewAssets.more")}
          disabled={loading}
          onPress={() => {
            setLoading(true);
            setError(undefined);
            setCursor(next);
          }}
        />
      )}
    </ScrollView>
  );
}
function FeedbackWrite({
  row,
  kind,
  onCase,
  ...props
}: Props & { row: TaskFeedback; kind: FeedbackCommand["kind"]; onCase: (path: string) => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(`${row.id}:${kind}`, true);
  const [outbox] = useState(() => feedbackOutbox(row.id, props.userId, props.generation, kind));
  const [initial] = useState(() => {
    try {
      return { pending: outbox.read(), error: undefined };
    } catch (cause) {
      return { pending: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  const [pending, setPending] = useState(initial.pending),
    [text, setText] = useState(initial.pending?.text ?? ""),
    [error, setError] = useState(initial.error),
    [saved, setSaved] = useState(false),
    [caseId, setCaseId] = useState<string>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  const limit = kind === "response" ? 2000 : 1000;
  const submit = () =>
    void op.run(
      async () => {
        const input = pending ?? { kind, clientKey: uuid.v4(), text: text.trim() };
        outbox.save(input);
        setPending(input);
        const result = await writeTaskFeedback(
          row,
          props.userId,
          props.generation,
          input,
          controller.current!.signal
        );
        outbox.clear(input.clientKey);
        return result;
      },
      (result) => {
        setPending(null);
        setError(undefined);
        setSaved(true);
        if (result.kind === "appeal") setCaseId(result.caseId);
      },
      (cause) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t(`feedbackHistory.${kind}`)}</ThemedText>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved ? (
        <>
          <ThemedText>{t("feedbackHistory.saved")}</ThemedText>
          <ThemedText selectable>{text}</ThemedText>
          {caseId && (
            <Action
              label={t("feedbackHistory.viewCase")}
              onPress={() => onCase(`/crews/cases/${encodeURIComponent(caseId)}`)}
            />
          )}
        </>
      ) : (
        <>
          <ThemedText>
            {t(pending ? "feedbackHistory.retryHelp" : "feedbackHistory.immutable")}
          </ThemedText>
          <TextInput
            accessibilityLabel={t(`feedbackHistory.${kind}`)}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={limit}
            editable={!op.busy && !pending && !initial.error}
            style={{
              color: theme.text,
              padding: 12,
              backgroundColor: theme.backgroundElement,
              borderRadius: 8,
            }}
          />
          <Action
            label={t(pending ? "feedbackHistory.retry" : "feedbackHistory.submit")}
            disabled={
              op.busy || !!initial.error || text.trim().length < 3 || text.trim().length > limit
            }
            onPress={submit}
          />
        </>
      )}
    </View>
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
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        backgroundColor: theme.backgroundElement,
        borderRadius: 8,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
