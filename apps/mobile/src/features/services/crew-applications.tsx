import { ApplicationAmendments } from "./application-amendments";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { formatFinanceMoney } from "./crew-finance-api";
import {
  fetchMyApplications,
  fetchApplicationTerms,
  confirmApplicationTerms,
  type Application,
  type Terms,
} from "./application-terms-api";
import { PositionInvitations } from "./position-invitations";
import { ApplicationInterview } from "./application-interview";
type Props = { userId: string; generation: number; onWeb: () => void };
export function CrewApplications(props: Props) {
  const active = useScreenActive();
  return active && props.generation === getAuthGeneration() ? (
    <Applications key={`${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Applications(props: Props) {
  const [invitations, setInvitations] = useState(false);
  const [revision, setRevision] = useState(0),
    [selected, setSelected] = useState<Application>();
  if (invitations)
    return (
      <PositionInvitations
        {...props}
        onClose={() => {
          setInvitations(false);
          setRevision((n) => n + 1);
        }}
      />
    );
  if (selected)
    return (
      <TermsReview
        {...props}
        application={selected}
        onClose={() => {
          setSelected(undefined);
          setRevision((n) => n + 1);
        }}
      />
    );
  return (
    <ApplicationPage
      key={revision}
      {...props}
      onInvitations={() => setInvitations(true)}
      onSelect={setSelected}
      onRefresh={() => {
        setRevision((n) => n + 1);
      }}
    />
  );
}
function ApplicationPage(
  props: Props & {
    onInvitations: () => void;
    onSelect: (app: Application) => void;
    onRefresh: () => void;
  }
) {
  const t = useTranslations();
  const [cursor, setCursor] = useState<string | null>(null);
  const [page, setPage] = useState<Awaited<ReturnType<typeof fetchMyApplications>>>();
  const [error, setError] = useState<string>(),
    [loading, setLoading] = useState(true);
  const records = useRef<Application[]>([]),
    seen = useRef(new Set<string>()),
    pending = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    pending.current = true;
    void fetchMyApplications(props.userId, cursor, c.signal)
      .then((value) => {
        if (c.signal.aborted || props.generation !== getAuthGeneration()) return;
        if (
          value.items.some((row) => records.current.some((old) => old.id === row.id)) ||
          (value.nextCursor && seen.current.has(value.nextCursor))
        )
          throw new Error("Application pagination changed. Refresh to reload.");
        if (cursor) seen.current.add(cursor);
        records.current = [...records.current, ...value.items];
        setPage({ ...value, items: records.current });
      })
      .catch((cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) {
          setPage(undefined);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) {
          pending.current = false;
          setLoading(false);
        }
      });
    return () => c.abort();
  }, [props.userId, props.generation, cursor]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("crewTerms.myApplications")}</ThemedText>
      <Action label={t("crewPositionInvites.title")} onPress={props.onInvitations} />
      <Action label={t("nativeApplications.webWorkflow")} onPress={props.onWeb} />
      {loading && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {page?.items.map((row) => (
        <Action
          key={row.id}
          disabled={loading}
          label={`${row.crewName} · ${row.positionType} · ${row.createdAt.slice(0, 10)} · ${t(`crewTerms.${row.status}`)}`}
          onPress={() => props.onSelect(row)}
        />
      ))}
      {page?.items.length === 0 && <ThemedText>{t("crewTerms.empty")}</ThemedText>}
      {page?.nextCursor && (
        <Action
          disabled={loading}
          label={t("crewTerms.more")}
          onPress={() => {
            if (pending.current) return;
            pending.current = true;
            setLoading(true);
            setCursor(page.nextCursor);
          }}
        />
      )}
      <Action label={t("crewTerms.refresh")} onPress={props.onRefresh} />
    </ScrollView>
  );
}
function TermsReview(props: Props & { application: Application; onClose: () => void }) {
  const [interview, setInterview] = useState(false);
  const [amendments, setAmendments] = useState(false);
  const [before, setBefore] = useState<number | null>(null),
    [revision, setRevision] = useState(0);
  if (amendments)
    return (
      <ApplicationAmendments
        {...props}
        crewId={props.application.crewId}
        applicationId={props.application.id}
        applicantId={props.application.applicantId}
        taskId={props.application.taskId!}
        onClose={() => {
          setAmendments(false);
          setBefore(null);
          setRevision((n) => n + 1);
        }}
      />
    );
  if (interview)
    return (
      <ApplicationInterview
        applicationId={props.application.id}
        userId={props.userId}
        generation={props.generation}
        onClose={() => setInterview(false)}
      />
    );
  return (
    <TermsPage
      key={`${revision}:${before}`}
      {...props}
      onAmendments={() => setAmendments(true)}
      onInterview={() => setInterview(true)}
      before={before}
      onMore={setBefore}
      onRefresh={() => {
        setBefore(null);
        setRevision((n) => n + 1);
      }}
    />
  );
}
function TermsPage(
  props: Props & {
    application: Application;
    onClose: () => void;
    onInterview: () => void;
    onAmendments: () => void;
    before: number | null;
    onMore: (before: number) => void;
    onRefresh: () => void;
  }
) {
  const t = useTranslations(),
    op = useAuthFormOperation(props.application.id, true);
  const theme = useTheme();
  const [page, setPage] = useState<Awaited<ReturnType<typeof fetchApplicationTerms>>>(),
    [error, setError] = useState<string>(),
    [result, setResult] = useState<Terms>(),
    [attempted, setAttempted] = useState(false),
    [denied, setDenied] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    void fetchApplicationTerms(props.application.id, props.before, c.signal).then(
      (value) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) setPage(value);
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => c.abort();
  }, [props.application.id, props.before, props.generation]);
  const latest = page?.items.find((row) => row.version === page.currentVersion);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <ThemedText>
        {props.application.crewName} · {props.application.positionType}
      </ThemedText>
      <Action disabled={op.busy} label={t("crewInterview.title")} onPress={props.onInterview} />
      {props.application.status === "approved" && props.application.taskId && (
        <Action disabled={op.busy} label={t("crewAmendments.title")} onPress={props.onAmendments} />
      )}
      <ThemedText>{t("crewTerms.title")}</ThemedText>
      {!page && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {page?.items.length === 0 && <ThemedText>{t("crewTerms.none")}</ThemedText>}
      {page?.items.map((row) => (
        <View
          key={row.id}
          style={{
            gap: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: theme.border,
            padding: 12,
          }}
        >
          <ThemedText>
            {t("crewTerms.version").replace("{version}", String(row.version))} ·{" "}
            {t(
              (result?.version === row.version ? result.confirmedAt : row.confirmedAt)
                ? "crewTerms.confirmed"
                : "crewTerms.awaiting"
            )}
          </ThemedText>
          <ThemedText>{row.scope}</ThemedText>
          <ThemedText>
            {formatFinanceMoney(row.feeAmount, row.currency)} / {t(`crewTerms.${row.feePeriod}`)}
          </ThemedText>
          <ThemedText>
            {t("crewTerms.share")} · {(row.revenueShareBp / 100).toFixed(2)}%
          </ThemedText>
          {row.shareBasis && <ThemedText>{row.shareBasis}</ThemedText>}
        </View>
      ))}
      {latest &&
        !latest.confirmedAt &&
        !result &&
        props.application.status === "pending" &&
        props.application.applicantId === props.userId && (
          <View style={{ gap: 12 }}>
            <ThemedText>{t("nativeApplications.review")}</ThemedText>
            <ThemedText>{t("crewTerms.noPayment")}</ThemedText>
            <Action
              primary
              disabled={op.busy || denied}
              label={
                attempted
                  ? t("nativeApplications.retry")
                  : t("crewTerms.confirm").replace("{version}", String(latest.version))
              }
              onPress={() => {
                if (props.generation !== getAuthGeneration()) return;
                void op.run(
                  () => {
                    setAttempted(true);
                    setError(undefined);
                    return confirmApplicationTerms(
                      props.application,
                      latest,
                      props.userId,
                      props.generation
                    );
                  },
                  setResult,
                  (cause) => {
                    setError(cause instanceof Error ? cause.message : String(cause));
                    const status =
                      cause && typeof cause === "object" && "status" in cause
                        ? Number(cause.status)
                        : 0;
                    if ([400, 401, 403, 404, 409, 422].includes(status)) setDenied(true);
                  }
                );
              }}
            />
          </View>
        )}
      {op.busy && <ActivityIndicator />}
      {page?.nextBeforeVersion && (
        <Action
          disabled={op.busy}
          label={t("nativeApplications.history")}
          onPress={() => props.onMore(page.nextBeforeVersion!)}
        />
      )}
      <Action disabled={op.busy} label={t("crewTerms.refresh")} onPress={props.onRefresh} />
      <Action
        disabled={op.busy}
        label={t("nativeApplications.webWorkflow")}
        onPress={props.onWeb}
      />
      <Action disabled={op.busy} label={t("nativeApplications.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Action({
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
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      style={{
        borderRadius: 8,
        padding: 12,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: primary ? theme.brand : theme.backgroundElement,
        opacity: disabled ? 0.5 : 1,
      }}
      onPress={onPress}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
