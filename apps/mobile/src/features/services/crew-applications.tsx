import { useRouter } from "expo-router";
import { toHref } from "@/lib/navigation";
import { useUserDisplays } from "./user-displays";
import { ApplicationReview } from "./application-review";
import { ApplicationAmendments } from "./application-amendments";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { ApiRequestError } from "@/lib/api-client";
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
  acceptApplicationOffer,
  fetchApplicationThread,
  type ApplicationThread,
  type Application,
  type Terms,
} from "./application-terms-api";
import { PositionInvitations } from "./position-invitations";
import { ApplicationInterview } from "./application-interview";
type Props = {
  userId: string;
  generation: number;
  onWeb: () => void;
  initialApplicationId?: string;
};
export function CrewApplications(props: Props) {
  const active = useScreenActive();
  return props.generation === getAuthGeneration() ? (
    <Applications
      key={`${props.userId}:${props.generation}:${props.initialApplicationId ?? ""}`}
      {...props}
      active={active}
    />
  ) : null;
}
function Applications(props: Props & { active: boolean }) {
  const [scope, setScope] = useState<"sent" | "received">("sent");
  const [requested, setRequested] = useState(props.initialApplicationId);
  const [invitations, setInvitations] = useState(false);
  const [revision, setRevision] = useState(0),
    [selected, setSelected] = useState<Application>();
  // Retain navigation intent, but remount private reads after foreground return.
  if (!props.active) return null;
  if (requested)
    return (
      <RequestedApplication
        {...props}
        applicationId={requested}
        onClose={() => setRequested(undefined)}
      />
    );
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
  if (selected && selected.applicantId !== props.userId)
    return (
      <RequestedApplication
        {...props}
        applicationId={selected.id}
        onClose={() => {
          setSelected(undefined);
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
      key={`${revision}:${scope}`}
      {...props}
      scope={scope}
      onScope={setScope}
      onInvitations={() => setInvitations(true)}
      onSelect={setSelected}
      onRefresh={() => {
        setRevision((n) => n + 1);
      }}
    />
  );
}
function RequestedApplication(props: Props & { applicationId: string; onClose: () => void }) {
  const t = useTranslations();
  const [thread, setThread] = useState<ApplicationThread>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetchApplicationThread(
      props.applicationId,
      props.userId,
      props.generation,
      controller.signal,
      "either"
    ).then(
      (value) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setThread(value);
      },
      (cause) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [props.applicationId, props.userId, props.generation, revision]);
  if (thread)
    return thread.applicantId === props.userId ? (
      <TermsReview {...props} application={thread} />
    ) : (
      <ApplicationReview {...props} crewId={thread.crewId} initialApplicationId={thread.id} />
    );
  return (
    <View style={{ padding: 16, gap: 12 }}>
      {error ? (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Action
            label={t("common.retry")}
            onPress={() => {
              setError(undefined);
              setRevision((n) => n + 1);
            }}
          />
        </>
      ) : (
        <ActivityIndicator />
      )}
      <Action label={t("nativeApplications.back")} onPress={props.onClose} />
    </View>
  );
}
function ApplicationPage(
  props: Props & {
    scope: "sent" | "received";
    onScope: (scope: "sent" | "received") => void;
    onInvitations: () => void;
    onSelect: (app: Application) => void;
    onRefresh: () => void;
  }
) {
  const t = useTranslations();
  const [cursor, setCursor] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [retryable, setRetryable] = useState(false);
  const [page, setPage] = useState<Awaited<ReturnType<typeof fetchMyApplications>>>();
  const [error, setError] = useState<string>(),
    [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const peerId = (row: Application) =>
    row.applicantId === props.userId ? row.ownerUserId : row.applicantId;
  const displays = useUserDisplays(
    `${props.userId}:${props.generation}`,
    (page?.items ?? []).flatMap((row) => (peerId(row) ? [peerId(row)!] : []))
  );
  const peerName = (row: Application) => displays?.get(peerId(row) ?? "")?.nickname ?? "";
  const filtered = page?.items.filter((row) =>
    `${peerName(row)} ${row.crewName} ${row.taskTitle ?? row.positionType}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase())
  );
  const theme = useTheme();
  const records = useRef<Application[]>([]),
    seen = useRef(new Set<string>()),
    pending = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    pending.current = true;
    void fetchMyApplications(props.userId, cursor, c.signal, props.scope)
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
          const temporary =
            cause instanceof ApiRequestError &&
            (cause.status === 0 || cause.status === 429 || cause.status >= 500);
          setRetryable(temporary);
          if (!temporary) setPage(undefined);
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
  }, [props.userId, props.generation, cursor, props.scope, retry]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("crewTerms.myApplications")}</ThemedText>
      <Action label={t("crewPositionInvites.title")} onPress={props.onInvitations} />
      <Action label={t("nativeApplications.webWorkflow")} onPress={props.onWeb} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["sent", "received"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ selected: props.scope === value }}
            style={{
              padding: 12,
              minHeight: 44,
              borderRadius: 8,
              backgroundColor:
                props.scope === value ? theme.backgroundSelected : theme.backgroundElement,
            }}
            onPress={() => props.onScope(value)}
          >
            <ThemedText>{t(`crewRecruitment.${value}`)}</ThemedText>
          </Pressable>
        ))}
      </View>
      <TextInput
        accessibilityLabel={t("crewRecruitment.search")}
        placeholder={t("crewRecruitment.search")}
        value={search}
        onChangeText={setSearch}
        style={{
          color: theme.text,
          minHeight: 44,
          padding: 12,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 8,
        }}
        placeholderTextColor={theme.textSecondary}
      />
      {loading && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {filtered?.map((row) => (
        <Action
          key={row.id}
          disabled={loading}
          label={`${peerName(row) ? `${peerName(row)} · ` : ""}${row.crewName} · ${row.taskTitle ?? row.positionType} · ${row.createdAt.slice(0, 10)} · ${t(`crewTerms.${row.status}`)}`}
          onPress={() => props.onSelect(row)}
        />
      ))}
      {filtered?.length === 0 && <ThemedText>{t("crewTerms.empty")}</ThemedText>}
      {error && retryable && (
        <Action
          label={t("common.retry")}
          disabled={loading}
          onPress={() => {
            if (pending.current) return;
            pending.current = true;
            setLoading(true);
            setError(undefined);
            setRetryable(false);
            setRetry((n) => n + 1);
          }}
        />
      )}
      {!error && page?.nextCursor && (
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
  const [amendments, setAmendments] = useState<ApplicationThread>();
  const [before, setBefore] = useState<number | null>(null),
    [revision, setRevision] = useState(0);
  if (amendments)
    return (
      <ApplicationAmendments
        {...props}
        crewId={amendments.crewId}
        applicationId={amendments.id}
        applicantId={amendments.applicantId}
        taskId={amendments.taskId!}
        onClose={() => {
          setAmendments(undefined);
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
      onAmendments={setAmendments}
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
    onAmendments: (thread: ApplicationThread) => void;
    before: number | null;
    onMore: (before: number) => void;
    onRefresh: () => void;
  }
) {
  const t = useTranslations(),
    op = useAuthFormOperation(props.application.id, true);
  const router = useRouter();
  const theme = useTheme();
  const [thread, setThread] = useState<ApplicationThread>();
  const [page, setPage] = useState<Awaited<ReturnType<typeof fetchApplicationTerms>>>(),
    [error, setError] = useState<string>(),
    [result, setResult] = useState<Terms>(),
    [attempted, setAttempted] = useState(false),
    [denied, setDenied] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    void Promise.all([
      fetchApplicationTerms(props.application.id, props.before, c.signal),
      fetchApplicationThread(props.application.id, props.userId, props.generation, c.signal),
    ]).then(
      (value) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) {
          setPage(value[0]);
          setThread(value[1]);
        }
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => c.abort();
  }, [props.application.id, props.before, props.generation, props.userId]);
  const latest = page?.items.find((row) => row.version === page.currentVersion);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <ThemedText>
        {props.application.crewName} · {props.application.positionType}
      </ThemedText>
      <Action disabled={op.busy} label={t("crewInterview.title")} onPress={props.onInterview} />
      {thread?.status === "approved" && thread.taskId && (
        <>
          <Action
            disabled={op.busy}
            label={t("crewFinance.openTask")}
            onPress={() => {
              if (props.generation !== getAuthGeneration()) return;
              router.push(
                toHref(
                  `/crew-tasks/${encodeURIComponent(thread.crewId)}?task=${encodeURIComponent(thread.taskId!)}`
                )
              );
            }}
          />
          <Action
            disabled={op.busy}
            label={t("crewAmendments.title")}
            onPress={() => props.onAmendments(thread)}
          />
        </>
      )}
      {thread?.taskTitle && <ThemedText>{thread.taskTitle}</ThemedText>}
      {thread?.dueAt && (
        <ThemedText>
          {t("crewOffers.deadline")}: {thread.dueAt.slice(0, 10)}
        </ThemedText>
      )}
      {result && <ThemedText>{t("crewOffers.accepted")}</ThemedText>}
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
      {latest && !result && thread?.status === "pending" && thread.applicantId === props.userId && (
        <View style={{ gap: 12 }}>
          <ThemedText>{t("nativeApplications.review")}</ThemedText>
          <ThemedText>{t("crewOffers.effect")}</ThemedText>
          <Action
            primary
            disabled={op.busy || denied}
            label={
              attempted
                ? t("nativeApplications.retry")
                : t("crewOffers.accept").replace("{version}", String(latest.version))
            }
            onPress={() => {
              if (props.generation !== getAuthGeneration()) return;
              void op.run(
                () => {
                  setAttempted(true);
                  setError(undefined);
                  return acceptApplicationOffer(thread, latest, props.userId, props.generation);
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
