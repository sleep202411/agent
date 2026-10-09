import { caseCategories, caseResolutions } from "./case-classification";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { useInitialCaseEvidence } from "./use-initial-case-evidence";
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
type Props = {
  crewId: string;
  taskId: string;
  userId: string;
  generation: number;
  initiallyOpen?: boolean;
};
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
  const [open, setOpen] = useState(props.initiallyOpen ?? false);
  const [visited, setVisited] = useState(props.initiallyOpen ?? false);
  return (
    <View style={{ gap: 8 }}>
      <Button
        label={t("taskCase.open")}
        onPress={() => {
          setVisited(true);
          setOpen((v) => !v);
        }}
      />
      {visited && (
        <View style={{ display: open ? "flex" : "none" }}>
          <Button
            label={t("feedbackHistory.cases")}
            onPress={() => router.push("/private-cases")}
          />
          <Form
            {...props}
            onCreated={(caseId) => router.push({ pathname: "/private-cases", params: { caseId } })}
          />
        </View>
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
    [category, setCategory] = useState<TaskCaseCommand["category"]>(initial.pending?.category),
    [desiredResolution, setDesiredResolution] = useState<TaskCaseCommand["desiredResolution"]>(
      initial.pending?.desiredResolution
    ),
    [title, setTitle] = useState(initial.pending?.title ?? ""),
    [message, setMessage] = useState(initial.pending?.message ?? ""),
    [evidence, setEvidence] = useState(initial.pending?.submissionIds ?? []),
    [context, setContext] = useState<TaskCaseContext>(),
    [error, setError] = useState(initial.error),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [saved, setSaved] = useState<string>();
  const initialEvidence = useInitialCaseEvidence(
    taskId,
    userId,
    generation,
    initial.pending?.clientKey
  );
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
    locked = op.busy || initialEvidence.busy || !!pending || !!saved || !!initial.error;
  const valid =
    eligible &&
    !!category &&
    !initialEvidence.busy &&
    !initialEvidence.unresolved &&
    !initialEvidence.blocked &&
    candidates.includes(respondent) &&
    title.trim().length > 0 &&
    message.trim().length > 0 &&
    message.trim().length <= 1000 &&
    evidence.every((id) => context?.submissions.some((s) => s.id === id));
  const submit = () => {
    const c = controller.current;
    if (!c || c.signal.aborted || (!pending && !valid)) return;
    void op.run(
      async () => {
        const request = pending ?? {
          clientKey: initialEvidence.caseId,
          respondentUserId: respondent,
          title,
          message,
          submissionIds: evidence,
          category,
          ...(initialEvidence.ids.length ? { attachmentIds: initialEvidence.ids } : {}),
          ...(desiredResolution ? { desiredResolution } : {}),
        };
        outbox.save(request);
        setPending(request);
        setError("");
        try {
          const result = await openTaskCase(taskId, userId, generation, request, c.signal);
          initialEvidence.clear();
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
              <ThemedText>{t("crewTaskDispute.category")}</ThemedText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {caseCategories.map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: category === value }}
                    disabled={locked}
                    onPress={() => setCategory(value)}
                    style={{ padding: 10 }}
                  >
                    <ThemedText>
                      {category === value ? "● " : "○ "}
                      {t(`crewTaskDispute.categories.${value}`)}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              <ThemedText>{t("crewTaskDispute.desiredResolution")}</ThemedText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {([undefined, ...caseResolutions] as const).map((value) => (
                  <Pressable
                    key={value ?? "none"}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: desiredResolution === value }}
                    disabled={locked}
                    onPress={() => setDesiredResolution(value)}
                    style={{ padding: 10 }}
                  >
                    <ThemedText>
                      {desiredResolution === value ? "● " : "○ "}
                      {t(
                        value
                          ? `crewTaskDispute.resolutions.${value}`
                          : "crewTaskDispute.noPreference"
                      )}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
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
                maxLength={1000}
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
              <ThemedText>{t("crewTaskDispute.initialEvidence")}</ThemedText>
              <ThemedText>{t("crewTaskDispute.initialEvidenceHint")}</ThemedText>
              {!!initialEvidence.error && (
                <ThemedText accessibilityRole="alert">{initialEvidence.error}</ThemedText>
              )}
              {initialEvidence.items.map((item) => (
                <View key={item.id} style={{ gap: 4 }}>
                  <ThemedText>
                    {item.name} ·{" "}
                    {t(
                      item.ready
                        ? "crewTaskDispute.evidenceReady"
                        : "crewTaskDispute.evidencePending"
                    )}
                  </ThemedText>
                  {!item.ready && (
                    <>
                      <Button
                        label={t("common.retry")}
                        disabled={locked}
                        onPress={() => void initialEvidence.retry(item.id)}
                      />
                      <Button
                        label={t("crewEvidence.confirmStored")}
                        disabled={locked}
                        onPress={() => void initialEvidence.retry(item.id, true)}
                      />
                    </>
                  )}
                  <Button
                    label={t("crewTaskDispute.removeEvidence")}
                    disabled={locked}
                    onPress={() => initialEvidence.remove(item.id)}
                  />
                </View>
              ))}
              <Button
                label={t("crewTaskDispute.initialEvidence")}
                disabled={
                  locked ||
                  initialEvidence.blocked ||
                  initialEvidence.unresolved ||
                  initialEvidence.items.length >= 5
                }
                onPress={() => void initialEvidence.add()}
              />
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
