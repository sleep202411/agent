import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import {
  DiscoveryAssistantRequestSchema,
  type DiscoveryAssistantResult,
} from "@repo/shared/discovery-assistant";
import { regionLabel } from "@repo/shared/regions";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ApiRequestError } from "@/lib/api-client";
import { serviceCategoryLabel } from "@/lib/creator-service-format";
import {
  cancelDiscovery,
  checkDiscovery,
  clearDiscovery,
  discoveryPending,
  recoverDiscoveryStorage,
  retryDiscovery,
  sendDiscovery,
  type AssistantScope,
  type AssistantRequest,
  type AssistantReceipt,
} from "./discovery-assistant-api";
type Result = Extract<DiscoveryAssistantResult, { status: "results" }>;
type Props = {
  scope: AssistantScope;
  current: AssistantRequest["conversation"]["current"];
  genreLabels?: { code: string; label: string }[];
  onOpen?: () => void;
  valid: boolean;
  onReview: (result: Result) => void;
  onApply: (result: Result) => void;
  onSelect: (result: Result, id: string) => void;
};
function Action({
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
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ paddingVertical: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
export function DiscoveryAssistantPanel(props: Props) {
  const [open, setOpen] = useState(false);
  const t = useTranslations(),
    gate = useAuthGate();
  return (
    <View style={{ gap: 10 }}>
      {!open ? (
        <Action
          label={t("discoveryAssistant.title")}
          onPress={() => {
            setOpen(true);
            props.onOpen?.();
          }}
        />
      ) : (
        <>
          {!props.scope.userId ? (
            <>
              <ThemedText>{t("discoveryAssistant.loginHint")}</ThemedText>
              <Action label={t("discoveryAssistant.login")} onPress={() => gate.requireAuth()} />
            </>
          ) : (
            <Conversation {...props} onClose={() => setOpen(false)} />
          )}
          {!props.scope.userId && (
            <Action label={t("discoveryAssistant.close")} onPress={() => setOpen(false)} />
          )}
        </>
      )}
    </View>
  );
}
function Conversation({
  scope,
  current,
  valid,
  onReview,
  onApply,
  onSelect,
  onClose,
  genreLabels = [],
}: Props & { onClose: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    active = useScreenActive();
  const [request, setRequest] = useState<AssistantRequest | null>(null),
    [receipt, setReceipt] = useState<AssistantReceipt | null>(null);
  const [history, setHistory] = useState<AssistantRequest["conversation"]["messages"]>([]),
    [text, setText] = useState("");
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [missing, setMissing] = useState(false),
    [denied, setDenied] = useState(false),
    [confirmReset, setConfirmReset] = useState(false);
  const owner = useRef<AbortController | null>(null),
    mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      try {
        const old = discoveryPending(scope).read();
        setRequest(old);
        setHistory(old?.conversation.messages ?? []);
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("discoveryAssistant.storage"));
      }
    });
    return () => {
      live = false;
      mounted.current = false;
      owner.current?.abort();
      owner.current = null;
    };
    // Parent keys account, generation, locale and mode; filter edits preserve the conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!active && owner.current) {
      owner.current.abort();
      owner.current = null;
      setBusy(false);
    }
  }, [active]);
  const isCurrent = (c: AbortController) =>
    mounted.current &&
    owner.current === c &&
    !c.signal.aborted &&
    scope.generation === getAuthGeneration();
  const accept = (next: AssistantReceipt, expected: AssistantRequest) => {
    setDenied(false);
    setReceipt(next);
    setMissing(false);
    setRequest(expected);
    const result = next.result;
    setHistory(
      result
        ? [
            ...expected.conversation.messages,
            {
              role: "assistant",
              content:
                result.status === "clarification"
                  ? result.question
                  : t("discoveryAssistant.resultSummary").replace(
                      "{count}",
                      String(result.matchedCount)
                    ),
            },
          ]
        : expected.conversation.messages
    );
  };
  const run = async (
    action: "send" | "check" | "retry" | "cancel" | "review" | "apply" | "select",
    expected: AssistantRequest,
    id?: string
  ) => {
    if (
      !active ||
      (denied && action !== "check") ||
      !ready ||
      (owner.current && action !== "cancel")
    )
      return;
    owner.current?.abort();
    const c = new AbortController();
    owner.current = c;
    setBusy(true);
    setError("");
    setReceipt(null);
    setMissing(false);
    setConfirmReset(false);
    if (action === "send") {
      setRequest(expected);
      setHistory(expected.conversation.messages);
    }
    try {
      const next =
        action === "send"
          ? await sendDiscovery(scope, expected, c.signal)
          : action === "retry"
            ? await retryDiscovery(scope, expected, c.signal)
            : action === "cancel"
              ? await cancelDiscovery(scope, expected, c.signal)
              : await checkDiscovery(scope, expected, c.signal);
      if (!isCurrent(c)) return;
      accept(next, expected);
      if (action === "send") setText("");
      const result = next.result;
      if (result?.status === "results" && result.kind === scope.kind) {
        if (action === "review") {
          onReview(result);
          onClose();
        }
        if (action === "apply") {
          onApply(result);
          onClose();
        }
        if (action === "select" && id) {
          if (result.cards.some((card) => card.id === id)) {
            onSelect(result, id);
            onClose();
          } else
            setError(
              t(
                scope.kind === "ips"
                  ? "contentGpsDiscovery.selectionUnavailable"
                  : "studioDiscovery.selectionUnavailable"
              )
            );
        }
      }
    } catch (e) {
      if (!isCurrent(c)) return;
      setError(e instanceof Error ? e.message : String(e));
      if (action === "check" && e instanceof ApiRequestError && e.status === 404) {
        setMissing(true);
        setDenied(false);
      }
      const permissionLost = e instanceof ApiRequestError && [401, 403].includes(e.status);
      try {
        const saved = discoveryPending(scope).read();
        setRequest(saved);
        setHistory(permissionLost ? [] : (saved?.conversation.messages ?? []));
      } catch {
        /* Keep the original storage/dispatch failure visible. */
      }
      if (permissionLost) {
        setDenied(true);
        setHistory([]);
        // Preserve the exact pending request for a read-only permission recheck.
        setReceipt(null);
      }
    } finally {
      if (isCurrent(c)) {
        owner.current = null;
        setBusy(false);
      }
    }
  };
  const send = () => {
    const parsed = DiscoveryAssistantRequestSchema.safeParse({
      requestId: uuid.v4(),
      locale: scope.locale,
      conversation: { current, messages: [...history, { role: "user", content: text }] },
    });
    if (!parsed.success) {
      setError(t("discoveryAssistant.invalid"));
      return;
    }
    void run("send", parsed.data);
  };
  const canSend =
    ready &&
    !denied &&
    !busy &&
    active &&
    valid &&
    !!text.trim() &&
    (!request || receipt?.status === "succeeded" || receipt?.status === "cancelled");
  const canReset = !busy && active && (!request || (!!receipt && receipt.status !== "dispatched"));
  const result = receipt?.result;
  const reset = () => {
    if (!canReset || denied) return;
    try {
      if (!ready) {
        const recovered = recoverDiscoveryStorage(scope);
        setReady(true);
        setRequest(recovered);
        setHistory(recovered?.conversation.messages ?? []);
        setConfirmReset(false);
        setError("");
        if (recovered) return;
      }
      if (request && receipt) clearDiscovery(scope, request, receipt);
      setRequest(null);
      setReceipt(null);
      setHistory([]);
      setText("");
      setMissing(false);
      setConfirmReset(false);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <View
      style={{ gap: 12, padding: 12, borderRadius: 8, backgroundColor: theme.backgroundElement }}
    >
      <ThemedText type="smallBold">{t("discoveryAssistant.title")}</ThemedText>
      <ThemedText>{t("discoveryAssistant.description")}</ThemedText>
      <ScrollView
        style={{ maxHeight: 220 }}
        nestedScrollEnabled
        accessibilityLabel={t("discoveryAssistant.conversation")}
      >
        {history.map((message, i) => (
          <View key={i} style={{ gap: 4, paddingVertical: 8 }}>
            <ThemedText type="smallBold">
              {t(message.role === "user" ? "discoveryAssistant.you" : "discoveryAssistant.title")}
            </ThemedText>
            <ThemedText>{message.content}</ThemedText>
          </View>
        ))}
      </ScrollView>
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {busy && <ActivityIndicator accessibilityLabel={t("discoveryAssistant.working")} />}
      {denied && request && (
        <Action
          label={t("discoveryAssistant.check")}
          onPress={() => void run("check", request)}
          disabled={busy || !active}
        />
      )}
      {request && !denied && (!receipt || receipt.status !== "succeeded") && (
        <View style={{ gap: 8 }}>
          {!busy && (
            <ThemedText>
              {t(
                receipt?.status === "uncertain"
                  ? "discoveryAssistant.uncertain"
                  : receipt?.status === "cancelled"
                    ? "discoveryAssistant.cancelled"
                    : "discoveryAssistant.recover"
              )}
            </ThemedText>
          )}
          <Action
            label={t("discoveryAssistant.check")}
            onPress={() => void run("check", request)}
            disabled={busy || !active}
          />
          {missing && (
            <Action
              label={t("discoveryAssistant.retry")}
              onPress={() => void run("retry", request)}
              disabled={busy || !active}
            />
          )}
          {(!receipt || receipt.status === "dispatched") && (
            <Action
              label={t("discoveryAssistant.cancel")}
              onPress={() => void run("cancel", request)}
              disabled={!active}
            />
          )}
        </View>
      )}
      {result?.status === "results" && result.kind === scope.kind && request && (
        <View style={{ gap: 8 }}>
          <ThemedText type="smallBold">{t("discoveryAssistant.proposal")}</ThemedText>
          <ThemedText>
            {t("discoveryAssistant.scope").replace("{count}", String(result.matchedCount))}
          </ThemedText>
          {result.kind === "creators" ? (
            <>
              {result.query.basedIn && (
                <ThemedText>
                  {t("discoveryAssistant.basedIn").replace(
                    "{place}",
                    `${result.query.basedIn.city} · ${regionLabel(result.query.basedIn.countryCode, scope.locale)}`
                  )}
                </ThemedText>
              )}
              {result.query.serves && (
                <ThemedText>
                  {t("discoveryAssistant.serves").replace(
                    "{place}",
                    `${result.query.serves.city} · ${regionLabel(result.query.serves.countryCode, scope.locale)}`
                  )}
                </ThemedText>
              )}
              {!!result.query.text && <ThemedText>{result.query.text}</ThemedText>}
              {result.query.category && (
                <ThemedText>{serviceCategoryLabel(result.query.category, t)}</ThemedText>
              )}
              {result.query.remoteOnly && <ThemedText>{t("discoveryAssistant.remote")}</ThemedText>}
              {result.query.availableForWork && (
                <ThemedText>{t("discoveryAssistant.available")}</ThemedText>
              )}
            </>
          ) : (
            <IpConditions result={result} genres={genreLabels} />
          )}
          <Action
            label={t("discoveryAssistant.review")}
            onPress={() => void run("review", request)}
            disabled={busy || !active}
          />
          <Action
            label={t("discoveryAssistant.applyResults")}
            onPress={() => void run("apply", request)}
            disabled={busy || !active}
          />
          {!result.cards.length && <ThemedText>{t("discoveryAssistant.empty")}</ThemedText>}
          {result.kind === "creators"
            ? result.cards.map((card) => (
                <View key={card.id} style={{ gap: 8, paddingVertical: 8 }}>
                  <ThemedText type="smallBold">{card.name}</ThemedText>
                  <ThemedText>
                    {t("discoveryAssistant.services").replace(
                      "{count}",
                      String(card.matchingServiceCount)
                    )}
                  </ThemedText>
                  <Action
                    label={t("studioDiscovery.viewStudio")}
                    onPress={() => void run("select", request, card.id)}
                    disabled={busy || !active}
                  />
                </View>
              ))
            : result.cards.map((card) => (
                <View key={card.id} style={{ gap: 8, paddingVertical: 8 }}>
                  <ThemedText type="smallBold">{card.title}</ThemedText>
                  <ThemedText>
                    {card.locations.map((place) => place.label).join(" · ") ||
                      t("discoveryAssistant.unknownPlace")}
                  </ThemedText>
                  {card.eras.map((era, index) => (
                    <ThemedText key={index}>
                      {era.startYear}–{era.endYear}
                    </ThemedText>
                  ))}
                  <ThemedText>
                    {card.episode?.durationSeconds != null
                      ? t("discoveryAssistant.seconds").replace(
                          "{seconds}",
                          String(card.episode.durationSeconds)
                        )
                      : t("discoveryAssistant.unknownDuration")}
                  </ThemedText>
                  <Action
                    label={t("contentGpsDiscovery.selectTitle").replace("{title}", card.title)}
                    onPress={() => void run("select", request, card.id)}
                    disabled={busy || !active}
                  />
                </View>
              ))}
        </View>
      )}
      {!valid && (
        <ThemedText accessibilityRole="alert">
          {t("discoveryAssistant.invalidConditions")}
        </ThemedText>
      )}
      <TextInput
        accessibilityLabel={t("discoveryAssistant.prompt")}
        placeholder={t(
          current.kind === "ips"
            ? "discoveryAssistant.ipExample"
            : "discoveryAssistant.creatorExample"
        )}
        placeholderTextColor={theme.textSecondary}
        value={text}
        onChangeText={setText}
        editable={!busy && !denied}
        maxLength={2000}
        multiline
        style={{
          minHeight: 80,
          padding: 10,
          color: theme.text,
          backgroundColor: theme.background,
          borderRadius: 8,
        }}
      />
      <Action label={t("discoveryAssistant.send")} onPress={send} disabled={!canSend} />
      <Action
        label={t("discoveryAssistant.newConversation")}
        onPress={() => (request || !ready ? setConfirmReset(true) : reset())}
        disabled={!canReset || denied}
      />
      {confirmReset && (
        <>
          <ThemedText>{t("discoveryAssistant.confirmReset")}</ThemedText>
          <Action label={t("discoveryAssistant.confirmNew")} onPress={reset} />
          <Action label={t("common.cancel")} onPress={() => setConfirmReset(false)} />
        </>
      )}
      <Action label={t("discoveryAssistant.close")} onPress={onClose} />
    </View>
  );
}

function IpConditions({
  result,
  genres,
}: {
  result: Extract<Result, { kind: "ips" }>;
  genres: { code: string; label: string }[];
}) {
  const t = useTranslations(),
    q = result.query;
  return (
    <View style={{ gap: 6 }}>
      {q.location && (
        <ThemedText>
          {t(
            q.location.kind === "story_setting"
              ? "contentGpsDiscovery.storyPlaces"
              : "contentGpsDiscovery.productionPlaces"
          )}{" "}
          ·{" "}
          {t(
            q.location.relation === "any"
              ? "contentGpsDiscovery.anyPlace"
              : "contentGpsDiscovery.allPlaces"
          )}
          :{" "}
          {q.location.placeIds
            .map(
              (id) =>
                result.cards.flatMap((card) => card.locations).find((place) => place.placeId === id)
                  ?.label ?? t("discoveryAssistant.selectedPlacesCount").replace("{count}", "1")
            )
            .join(" · ")}
        </ThemedText>
      )}
      {q.era && (
        <ThemedText>
          {q.era.startYear}–{q.era.endYear} ·{" "}
          {t(
            q.era.relation === "overlaps"
              ? "contentGpsDiscovery.overlappingEra"
              : "contentGpsDiscovery.containedEra"
          )}
        </ThemedText>
      )}
      {q.duration && (
        <ThemedText>
          {t("discoveryAssistant.maximumSeconds").replace(
            "{seconds}",
            String(q.duration.maxSeconds)
          )}{" "}
          ·{" "}
          {t(
            q.duration.unknown === "exclude"
              ? "contentGpsDiscovery.excludeUnknown"
              : "contentGpsDiscovery.includeUnknown"
          )}
        </ThemedText>
      )}
      {q.genreCodes.length > 0 && (
        <ThemedText>
          {t("contentGpsDiscovery.genre")}:{" "}
          {q.genreCodes
            .map(
              (code) =>
                genres.find((g) => g.code === code)?.label ??
                t("discoveryAssistant.genreCount").replace("{count}", "1")
            )
            .join(" · ")}
        </ThemedText>
      )}
      {(q.duration?.unit === "film" || q.moodPreferences.length > 0) && (
        <ThemedText>{t("contentGpsDiscovery.unsupportedConditions")}</ThemedText>
      )}
    </View>
  );
}
