import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import {
  fetchApplicationInterview,
  futureInterviewTime,
  interviewUpdate,
  updateApplicationInterview,
  type InterviewUpdate,
} from "./application-interview-api";
export function ApplicationInterview(props: {
  applicationId: string;
  userId: string;
  applicantId?: string;
  reviewer?: boolean;
  generation: number;
  onClose: () => void;
}) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const applicantId = props.applicantId ?? props.userId;
  const applicant = applicantId === props.userId;
  const [time, setTime] = useState("");
  const op = useAuthFormOperation(props.applicationId, true);
  const [before, setBefore] = useState<number | null>(null),
    [revision, setRevision] = useState(0);
  const [page, setPage] = useState<Awaited<ReturnType<typeof fetchApplicationInterview>>>();
  const [error, setError] = useState<string>(),
    [message, setMessage] = useState("");
  const [retry, setRetry] = useState<InterviewUpdate>(),
    [denied, setDenied] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    void fetchApplicationInterview(props.applicationId, before, c.signal).then(
      (value) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) setPage(value);
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => c.abort();
  }, [props.applicationId, props.generation, before, revision]);
  const reload = () => {
    setPage(undefined);
    setError(undefined);
    setBefore(null);
    setRevision((n) => n + 1);
    setMessage("");
    setTime("");
    setDenied(false);
  };
  const write = (action: InterviewUpdate["action"]) => {
    if (!page || props.generation !== getAuthGeneration()) return;
    let scheduledAt: string | null = null;
    if (!retry && action === "schedule") {
      try {
        scheduledAt = futureInterviewTime(time);
      } catch {
        setError(t("crewInterview.futureRequired"));
        return;
      }
    }
    const parsed = interviewUpdate.safeParse(
      retry ?? {
        expectedVersion: page.version,
        requestKey: uuid.v4(),
        action,
        message,
        ...(scheduledAt ? { scheduledAt } : {}),
      }
    );
    if (!parsed.success) {
      setError(t("crewInterview.messageRequired"));
      return;
    }
    const body = parsed.data;
    void op.run(
      () => {
        setError(undefined);
        return updateApplicationInterview(
          props.applicationId,
          props.userId,
          props.generation,
          body
        );
      },
      () => {
        setRetry(undefined);
        reload();
      },
      (cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        const status =
          cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : 0;
        if ([400, 401, 403, 404, 409, 422].includes(status)) {
          setRetry(undefined);
          setDenied(true);
        } else setRetry(body);
      }
    );
  };
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || op.busy }}
      disabled={disabled || op.busy}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        opacity: disabled || op.busy ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("crewInterview.title")}</ThemedText>
      {!page && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {page && (
        <>
          <ThemedText>
            {t(`crewInterview.${page.state}`)} ·{" "}
            {t("crewInterview.version").replace("{version}", String(page.version))}
          </ThemedText>
          {page.scheduledAt && (
            <ThemedText>{new Date(page.scheduledAt).toLocaleString(locale)}</ThemedText>
          )}
          {!page.canUpdate && <ThemedText>{t("crewInterview.readOnly")}</ThemedText>}
          {retry ? (
            <>
              {<ThemedText>{t("crewInterview.retryHelp")}</ThemedText>}
              {button(t("crewInterview.retry"), () => write(retry.action))}
            </>
          ) : (
            before === null &&
            page.canUpdate &&
            (applicant || props.reviewer) && (
              <>
                <ThemedText>{t("crewInterview.messageLabel")}</ThemedText>
                <TextInput
                  accessibilityLabel={t("crewInterview.messageLabel")}
                  multiline
                  maxLength={4000}
                  value={message}
                  onChangeText={setMessage}
                  editable={!op.busy && !denied}
                  style={{
                    color: theme.text,
                    borderColor: theme.border,
                    borderWidth: 1,
                    borderRadius: 8,
                    padding: 12,
                    minHeight: 90,
                  }}
                />
                <ThemedText>{t("crewInterview.sharedNote")}</ThemedText>
                {!applicant && props.reviewer && (
                  <>
                    <ThemedText>
                      {t("crewInterview.timeLabel").replace(
                        "{timezone}",
                        Intl.DateTimeFormat().resolvedOptions().timeZone
                      )}
                    </ThemedText>
                    <TextInput
                      accessibilityLabel={t("reviewerInterview.time")}
                      placeholder="YYYY-MM-DD HH:mm"
                      value={time}
                      onChangeText={setTime}
                      editable={!op.busy && !denied}
                      style={{
                        color: theme.text,
                        borderWidth: 1,
                        borderColor: theme.border,
                        padding: 12,
                        borderRadius: 8,
                      }}
                    />
                    {button(t("crewInterview.schedule"), () => write("schedule"), denied)}
                    {page.state === "confirmed" &&
                      button(t("crewInterview.complete"), () => write("complete"), denied)}
                  </>
                )}
                {applicant &&
                  page.state === "proposed" &&
                  button(t("crewInterview.confirm"), () => write("confirm"), denied)}
                {["proposed", "confirmed"].includes(page.state) &&
                  button(t("crewInterview.cancel"), () => write("cancel"), denied)}
                {button(t("crewInterview.message"), () => write("message"), denied)}
              </>
            )
          )}
          {page.items.map((row) => (
            <View
              key={row.id}
              style={{
                padding: 12,
                gap: 8,
                borderColor: theme.border,
                borderWidth: 1,
                borderRadius: 8,
              }}
            >
              <ThemedText>
                {t(`crewInterview.${row.action}`)} ·{" "}
                {t(
                  row.actorUserId === applicantId
                    ? "crewInterview.applicant"
                    : "crewInterview.reviewer"
                )}{" "}
                · {new Date(row.createdAt).toLocaleString(locale)}
              </ThemedText>
              {row.scheduledAt && (
                <ThemedText>{new Date(row.scheduledAt).toLocaleString(locale)}</ThemedText>
              )}
              <ThemedText>{row.message}</ThemedText>
            </View>
          ))}
          {page.nextBeforeVersion &&
            button(
              t("crewInterview.older"),
              () => {
                setMessage("");
                setPage(undefined);
                setError(undefined);
                setBefore(page.nextBeforeVersion);
              },
              !!retry
            )}
        </>
      )}
      {op.busy && <ActivityIndicator />}
      {button(t("crewInterview.refresh"), reload, !!retry)}
      {button(t("nativeApplications.back"), props.onClose)}
    </ScrollView>
  );
}
