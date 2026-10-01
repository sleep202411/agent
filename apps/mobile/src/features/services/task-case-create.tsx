import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { ApiRequestError } from "@/lib/api-client";
import { useRouter } from "expo-router";
import {
  fetchTaskCaseContext,
  taskCaseOutbox,
  openTaskCase,
  type TaskCaseCommand,
  type TaskCaseContext,
} from "./task-case-api";
type Props = { crewId: string; taskId: string; userId: string; generation: number };
export function TaskCaseCreate(props: Props) {
  const active = useScreenActive();
  return active && getAuthGeneration() === props.generation ? (
    <Session key={JSON.stringify(props)} {...props} />
  ) : null;
}
function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ padding: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
function Session(props: Props) {
  const t = useTranslations(),
    router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Button label={t("taskCase.open")} onPress={() => setOpen((v) => !v)} />
      {open && (
        <>
          <Button
            label={t("feedbackHistory.cases")}
            onPress={() => router.push("/private-cases")}
          />
          <Form
            {...props}
            onCreated={(caseId) => router.push({ pathname: "/private-cases", params: { caseId } })}
          />
        </>
      )}
    </View>
  );
}
function Form({
  crewId,
  taskId,
  userId,
  generation,
  onCreated,
}: Props & { onCreated: (id: string) => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(taskId, true);
  const [outbox] = useState(() => taskCaseOutbox(taskId, userId, generation));
  const [initial] = useState(() => {
    try {
      return { pending: outbox.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState<TaskCaseCommand | null>(initial.pending ?? null),
    [respondent, setRespondent] = useState(initial.pending?.respondentUserId ?? ""),
    [title, setTitle] = useState(initial.pending?.title ?? ""),
    [message, setMessage] = useState(initial.pending?.message ?? ""),
    [evidence, setEvidence] = useState(initial.pending?.submissionIds ?? []),
    [context, setContext] = useState<TaskCaseContext>(),
    [error, setError] = useState(initial.error),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [saved, setSaved] = useState<string>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    return () => c.abort();
  }, []);
  useEffect(() => {
    const c = new AbortController();
    void fetchTaskCaseContext(crewId, taskId, generation, c.signal)
      .then((value) => {
        if (!c.signal.aborted) setContext(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setContext(undefined);
          setError(String(e.message ?? e));
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [crewId, taskId, generation, revision]);
  const eligible = context?.participants.includes(userId),
    candidates = context?.participants.filter((id) => id !== userId) ?? [],
    locked = op.busy || !!pending || !!saved || !!initial.error;
  const valid =
    eligible &&
    candidates.includes(respondent) &&
    title.trim().length > 0 &&
    message.trim().length > 0 &&
    evidence.every((id) => context?.submissions.some((s) => s.id === id));
  const submit = () => {
    const c = controller.current;
    if (!c || c.signal.aborted || (!pending && !valid)) return;
    void op.run(
      async () => {
        const request = pending ?? {
          clientKey: uuid.v4(),
          respondentUserId: respondent,
          title,
          message,
          submissionIds: evidence,
        };
        outbox.save(request);
        setPending(request);
        setError("");
        try {
          const result = await openTaskCase(taskId, userId, generation, request, c.signal);
          outbox.clear(request.clientKey);
          return result.id;
        } catch (e) {
          if (e instanceof ApiRequestError && [400, 401, 403, 404, 409, 422].includes(e.status)) {
            outbox.clear(request.clientKey);
            setPending(null);
            setContext(undefined);
          }
          throw e;
        }
      },
      setSaved,
      (e) => setError(String(e instanceof Error ? e.message : e))
    );
  };
  return (
    <View style={{ gap: 8 }}>
      <ThemedText>{t("taskCase.help")}</ThemedText>
      {loading && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Button
        label={t("thread.refresh")}
        disabled={op.busy || loading}
        onPress={() => {
          setLoading(true);
          setContext(undefined);
          setError(initial.error);
          setRevision((v) => v + 1);
        }}
      />
      {saved ? (
        <>
          <ThemedText>{t("feedbackHistory.saved")}</ThemedText>
          <Button label={t("feedbackHistory.viewCase")} onPress={() => onCreated(saved)} />
        </>
      ) : (
        <>
          {context && !eligible && <ThemedText>{t("taskCase.notParticipant")}</ThemedText>}
          {(eligible || pending) && (
            <>
              <ThemedText>{t("taskCase.respondent")}</ThemedText>
              {pending ? (
                <ThemedText>{pending.respondentUserId}</ThemedText>
              ) : (
                candidates.map((id) => (
                  <Pressable
                    key={id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: respondent === id }}
                    disabled={locked}
                    onPress={() => setRespondent(id)}
                    style={{ padding: 10 }}
                  >
                    <ThemedText>
                      {respondent === id ? "● " : "○ "}
                      {id}
                    </ThemedText>
                  </Pressable>
                ))
              )}
              {!pending && !candidates.length && (
                <ThemedText>{t("taskCase.noRespondent")}</ThemedText>
              )}
              <TextInput
                accessibilityLabel={t("taskCase.subject")}
                placeholder={t("taskCase.subject")}
                placeholderTextColor={theme.textSecondary}
                value={title}
                onChangeText={setTitle}
                editable={!locked}
                maxLength={180}
                style={{ color: theme.text, padding: 12 }}
              />
              <TextInput
                accessibilityLabel={t("privateCases.message")}
                placeholder={t("privateCases.message")}
                placeholderTextColor={theme.textSecondary}
                value={message}
                onChangeText={setMessage}
                editable={!locked}
                multiline
                maxLength={4000}
                style={{ color: theme.text, padding: 12, minHeight: 72 }}
              />
              <ThemedText>{t("taskCase.evidence")}</ThemedText>
              {!pending &&
                context &&
                evidence.some((id) => !context.submissions.some((s) => s.id === id)) && (
                  <Button
                    label={t("taskCase.clearEvidence")}
                    disabled={locked}
                    onPress={() => setEvidence([])}
                  />
                )}
              {pending
                ? pending.submissionIds.map((id) => <ThemedText key={id}>{id}</ThemedText>)
                : context?.submissions.map((s) => (
                    <Pressable
                      key={s.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: evidence.includes(s.id) }}
                      disabled={locked || (!evidence.includes(s.id) && evidence.length >= 20)}
                      onPress={() =>
                        setEvidence((old) =>
                          old.includes(s.id) ? old.filter((id) => id !== s.id) : [...old, s.id]
                        )
                      }
                      style={{ padding: 10 }}
                    >
                      <ThemedText>
                        {evidence.includes(s.id) ? "☑ " : "☐ "}
                        {s.versionNumber} · {s.id}
                      </ThemedText>
                    </Pressable>
                  ))}
              {pending && <ThemedText>{t("feedbackHistory.retryHelp")}</ThemedText>}
              <Button
                label={t(pending ? "feedbackHistory.retry" : "feedbackHistory.submit")}
                disabled={op.busy || !!initial.error || (!pending && !valid)}
                onPress={submit}
              />
            </>
          )}
        </>
      )}
    </View>
  );
}
