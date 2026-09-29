import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import {
  fetchPositionInvitations,
  fetchPositionInvitation,
  decidePositionInvitation,
  invitationDecision,
  type InvitationPreview,
  type InvitationDecision,
} from "./position-invitation-api";
type Props = { userId: string; generation: number; onClose: () => void };
export function PositionInvitations(props: Props) {
  const [selected, setSelected] = useState<string>(),
    [cursor, setCursor] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  if (selected)
    return (
      <InvitationReview
        key={selected}
        {...props}
        invitationId={selected}
        onClose={() => {
          setSelected(undefined);
          setCursor(null);
          setRevision((n) => n + 1);
        }}
      />
    );
  return (
    <InvitationPage
      key={`${revision}:${cursor}`}
      {...props}
      cursor={cursor}
      onSelect={setSelected}
      onMore={setCursor}
      onRefresh={() => {
        setCursor(null);
        setRevision((n) => n + 1);
      }}
    />
  );
}
function InvitationPage(
  props: Props & {
    cursor: string | null;
    onSelect: (id: string) => void;
    onMore: (cursor: string) => void;
    onRefresh: () => void;
  }
) {
  const t = useTranslations(),
    locale = useLocale();
  const [page, setPage] = useState<Awaited<ReturnType<typeof fetchPositionInvitations>>>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const c = new AbortController();
    void fetchPositionInvitations(props.userId, props.cursor, c.signal).then(
      (value) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) setPage(value);
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => c.abort();
  }, [props.userId, props.generation, props.cursor]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("crewPositionInvites.title")}</ThemedText>
      <ThemedText>{t("crewPositionInvites.help")}</ThemedText>
      {!page && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {page?.items.length === 0 && <ThemedText>{t("crewPositionInvites.empty")}</ThemedText>}
      {page?.items.map((row) => (
        <Action
          key={row.id}
          label={`${t("crewPositionInvites.invitation")} · ${t(`crewPositionInvites.${row.status}`)} · ${t("crewPositionInvites.expires").replace("{date}", new Date(row.expiresAt).toLocaleString(locale))}`}
          onPress={() => props.onSelect(row.id)}
        />
      ))}
      {page?.nextCursor && (
        <Action
          label={t("crewPositionInvites.more")}
          onPress={() => props.onMore(page.nextCursor!)}
        />
      )}
      <Action label={t("crewPositionInvites.refresh")} onPress={props.onRefresh} />
      <Action label={t("nativeApplications.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function InvitationReview(props: Props & { invitationId: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme(),
    op = useAuthFormOperation(props.invitationId, true);
  const [row, setRow] = useState<InvitationPreview>(),
    [revision, setRevision] = useState(0),
    [error, setError] = useState<string>();
  const [message, setMessage] = useState(""),
    [portfolio, setPortfolio] = useState("");
  const [retry, setRetry] = useState<InvitationDecision>(),
    [denied, setDenied] = useState(false),
    [result, setResult] = useState<"accepted" | "declined">();
  useEffect(() => {
    const c = new AbortController();
    void fetchPositionInvitation(props.invitationId, props.userId, c.signal).then(
      (value) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) setRow(value);
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => c.abort();
  }, [props.invitationId, props.userId, props.generation, revision]);
  const decide = (action: "accept" | "decline") => {
    if (!row || props.generation !== getAuthGeneration()) return;
    const parsed = invitationDecision.safeParse(
      retry ??
        (action === "decline"
          ? { action }
          : { action, message: message.trim() || null, portfolioUrl: portfolio.trim() || null })
    );
    if (!parsed.success) {
      setError(t("crewPositionInvites.invalidPortfolio"));
      return;
    }
    const body = parsed.data;
    void op.run(
      () => {
        setError(undefined);
        return decidePositionInvitation(row, props.userId, props.generation, body, !!retry);
      },
      (value) => {
        setRetry(undefined);
        setResult(value.status);
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
  const editable =
    row?.status === "pending" && !row.expired && Date.parse(row.expiresAt) > now && !result;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("crewPositionInvites.title")}</ThemedText>
      {!row && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {row && (
        <>
          <ThemedText>{row.position.positionType}</ThemedText>
          <ThemedText>{row.position.description}</ThemedText>
          <ThemedText>{row.position.requiredSkills.join(", ")}</ThemedText>
          <ThemedText>{t(`crewPositionInvites.${result ?? row.status}`)}</ThemedText>
          <ThemedText>
            {t("crewPositionInvites.expires").replace(
              "{date}",
              new Date(row.expiresAt).toLocaleString(locale)
            )}
          </ThemedText>
          {!result && (row.expired || Date.parse(row.expiresAt) <= now) && (
            <ThemedText>{t("crewPositionInvites.expired")}</ThemedText>
          )}
          {(result === "accepted" || row.status === "accepted") && (
            <ThemedText>{t("crewPositionInvites.acceptedHelp")}</ThemedText>
          )}
          {retry ? (
            <>
              <ThemedText>{t("crewPositionInvites.retryHelp")}</ThemedText>
              <Action
                disabled={op.busy}
                label={t("crewPositionInvites.retry")}
                onPress={() => decide(retry.action)}
              />
            </>
          ) : (
            editable && (
              <>
                <ThemedText>{t("crewPositionInvites.message")}</ThemedText>
                <TextInput
                  accessibilityLabel={t("crewPositionInvites.message")}
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  maxLength={1000}
                  editable={!op.busy && !denied}
                  style={{
                    color: theme.text,
                    borderColor: theme.border,
                    borderWidth: 1,
                    padding: 12,
                    borderRadius: 8,
                  }}
                />
                <ThemedText>{t("crewPositionInvites.portfolio")}</ThemedText>
                <TextInput
                  accessibilityLabel={t("crewPositionInvites.portfolio")}
                  value={portfolio}
                  onChangeText={setPortfolio}
                  maxLength={512}
                  autoCapitalize="none"
                  keyboardType="url"
                  editable={!op.busy && !denied}
                  style={{
                    color: theme.text,
                    borderColor: theme.border,
                    borderWidth: 1,
                    padding: 12,
                    borderRadius: 8,
                  }}
                />
                <Action
                  disabled={op.busy || denied}
                  label={t("crewPositionInvites.accept")}
                  onPress={() => decide("accept")}
                />
                <Action
                  disabled={op.busy || denied}
                  label={t("crewPositionInvites.decline")}
                  onPress={() => decide("decline")}
                />
              </>
            )
          )}
        </>
      )}
      {op.busy && <ActivityIndicator />}
      <Action
        disabled={op.busy || !!retry}
        label={t("crewPositionInvites.refresh")}
        onPress={() => {
          setRow(undefined);
          setError(undefined);
          setDenied(false);
          setResult(undefined);
          setMessage("");
          setPortfolio("");
          setRevision((n) => n + 1);
        }}
      />
      <Action disabled={op.busy} label={t("nativeApplications.back")} onPress={props.onClose} />
    </ScrollView>
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
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        borderColor: theme.border,
        borderWidth: 1,
        backgroundColor: theme.backgroundElement,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
