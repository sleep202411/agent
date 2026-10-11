import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { useScreenActive } from "@/hooks/use-app-active";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ApiRequestError } from "@/lib/api-client";
import {
  fetchOwnedGames,
  fetchStageApplications,
  productionOutbox,
  saveProduction,
  stages,
  type OwnedGame,
  type StageResult,
  type ProductionCommand,
  type ProductionKind,
} from "./production-api";
type Props = { ipId: string; userId: string; generation: number; kind: ProductionKind };
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
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
/** Mounted inside the account/generation/route-gated Rights screen. */
export function IpProductionPanel({ ipId, userId, generation, kind }: Props) {
  const active = useScreenActive();
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(`${ipId}:${kind}`, true);
  const [outbox] = useState(() => productionOutbox(ipId, userId, generation, kind));
  const [initial] = useState(() => {
    try {
      return { pending: outbox.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState(initial.pending),
    [error, setError] = useState(initial.error);
  const [games, setGames] = useState<OwnedGame[]>(),
    [next, setNext] = useState<string | null>(null),
    [data, setData] = useState<StageResult>();
  const [loading, setLoading] = useState(true),
    [saved, setSaved] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [stage, setStage] = useState<(typeof stages)[number]>(
    initial.pending?.kind === "stages" ? initial.pending.stage : "story_testing"
  );
  const [reason, setReason] = useState(
    initial.pending?.kind === "stages" ? initial.pending.reason : ""
  );
  const controller = useRef<AbortController | null>(null),
    cursors = useRef(new Set<string>());
  const failure = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    if (e instanceof ApiRequestError && [401, 403, 404].includes(e.status)) {
      setGames(undefined);
      setData(undefined);
      setNext(null);
      setReviewed(false);
      setConfirm(false);
    }
  };
  const load = async (signal: AbortSignal, cursor?: string) =>
    kind === "games"
      ? { kind: "games" as const, value: await fetchOwnedGames(ipId, generation, signal, cursor) }
      : { kind: "stages" as const, value: await fetchStageApplications(ipId, generation, signal) };
  const accept = (
    result: Awaited<ReturnType<typeof load>>,
    signal: AbortSignal,
    cursor?: string
  ) => {
    if (signal.aborted) return;
    if (result.kind === "games") {
      const value = result.value;
      if (cursor && value.nextCursor && cursors.current.has(value.nextCursor))
        throw new Error("Game pagination repeated. Refresh the list.");
      if (!cursor) cursors.current.clear();
      if (cursor) cursors.current.add(cursor);
      setGames((old) =>
        cursor
          ? [
              ...new Map(
                [...(old ?? []), ...value.items].map((item) => [item.gameId, item])
              ).values(),
            ]
          : value.items
      );
      setNext(value.nextCursor);
    } else setData(result.value);
  };
  const read = async (signal: AbortSignal, cursor?: string) =>
    accept(await load(signal, cursor), signal, cursor);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void load(c.signal)
      .then((value) => accept(value, c.signal))
      .catch((e) => {
        if (!c.signal.aborted) failure(e);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
    // Each account/IP/kind gets a fresh mounted instance from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ipId, generation, kind]);
  const refresh = (cursor?: string) => {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    setConfirm(false);
    setReviewed(false);
    setError(initial.error);
    void op.run(
      () => read(signal, cursor),
      () => {
        if (!cursor) setReviewed(true);
      },
      failure
    );
  };
  const submit = (command: ProductionCommand) => {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    setError("");
    setSaved(false);
    setReviewed(false);
    setConfirm(false);
    void op.run(
      async () => {
        outbox.save(command);
        setPending(command);
        await saveProduction(ipId, userId, generation, command, signal);
        setPending(null);
        setSaved(true);
        setGames(undefined);
        setData(undefined);
        setNext(null);
        setReason("");
        await read(signal);
      },
      () => {},
      failure
    );
  };
  const busy = loading || op.busy,
    frozen = busy || !!pending || !!initial.error;
  const stageLabel = (value: StageResult["state"]["stage"]) => t(`ipProduction.${value}`);
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      <ThemedText type="small" themeColor="textSecondary">
        {t(kind === "games" ? "ipProduction.gamesHint" : "ipProduction.stagesHint")}
      </ThemedText>
      {(loading || op.busy) && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved && <ThemedText>{t("ipProduction.saved")}</ThemedText>}
      <Button label={t("thread.refresh")} disabled={busy} onPress={() => refresh()} />
      {kind === "games" && games && (
        <>
          {!games.length && <ThemedText>{t("ipProduction.noGames")}</ThemedText>}
          {games.map((game) => (
            <View
              key={game.gameId}
              style={{
                gap: 8,
                padding: 12,
                borderRadius: 8,
                backgroundColor: theme.backgroundElement,
              }}
            >
              <ThemedText>{game.title}</ThemedText>
              {game.linkedElsewhere ? (
                <ThemedText type="small">{t("ipProduction.elsewhere")}</ThemedText>
              ) : (
                <Button
                  label={t(game.linked ? "ipProduction.unlink" : "ipProduction.link")}
                  disabled={frozen}
                  onPress={() =>
                    submit({
                      kind: "games",
                      clientKey: uuid.v4(),
                      gameId: game.gameId,
                      expectedVersion: game.version,
                      active: !game.linked,
                    })
                  }
                />
              )}
            </View>
          ))}
          {next && (
            <Button label={t("ipProduction.more")} disabled={busy} onPress={() => refresh(next)} />
          )}
        </>
      )}
      {kind === "stages" && data && (
        <>
          <ThemedText>
            {t("ipProduction.current")}: {stageLabel(data.state.stage)}
          </ThemedText>
          {data.items.some((item) => item.status === "pending") ? (
            <ThemedText>{t("ipProduction.awaiting")}</ThemedText>
          ) : (
            <>
              <ThemedText>{t("ipProduction.target")}</ThemedText>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {stages.map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: value === stage, disabled: frozen }}
                    disabled={frozen}
                    onPress={() => setStage(value)}
                    style={{
                      padding: 12,
                      backgroundColor: stage === value ? theme.backgroundElement : undefined,
                      borderRadius: 8,
                    }}
                  >
                    <ThemedText type="small">
                      {value === stage ? "● " : "○ "}
                      {stageLabel(value)}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              <ThemedText>{t("ipProduction.reason")}</ThemedText>
              <TextInput
                accessibilityLabel={t("ipProduction.reason")}
                value={reason}
                onChangeText={setReason}
                editable={!frozen}
                multiline
                maxLength={1000}
                style={{
                  padding: 12,
                  minHeight: 96,
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  borderRadius: 8,
                }}
              />
              <Button
                label={t("ipProduction.submit")}
                disabled={frozen || !reason.trim() || stage === data.state.stage}
                onPress={() =>
                  submit({
                    kind: "stages",
                    clientKey: uuid.v4(),
                    stage,
                    reason: reason.trim(),
                    expectedVersion: data.state.version,
                  })
                }
              />
            </>
          )}
          <ThemedText type="smallBold">{t("ipProduction.history")}</ThemedText>
          {!data.items.length && <ThemedText>{t("ipProduction.noApplications")}</ThemedText>}
          {data.items.map((item) => (
            <View
              key={item.id}
              style={{
                gap: 8,
                padding: 12,
                backgroundColor: theme.backgroundElement,
                borderRadius: 8,
              }}
            >
              <ThemedText>
                {stageLabel(item.stage)} · {t(`ipProduction.${item.status}`)}
              </ThemedText>
              <ThemedText type="small">{item.reason}</ThemedText>
              {!!item.reviewReason && (
                <ThemedText type="small">
                  {t("ipProduction.review")}: {item.reviewReason}
                </ThemedText>
              )}
            </View>
          ))}
        </>
      )}
      {pending && (
        <View style={{ gap: 8 }}>
          <ThemedText>{t("ipProduction.pendingRequest")}</ThemedText>
          {pending.kind === "games" && (
            <ThemedText type="small">
              {t(pending.active ? "ipProduction.link" : "ipProduction.unlink")}:{" "}
              {games?.find((game) => game.gameId === pending.gameId)?.title ?? pending.gameId}
            </ThemedText>
          )}
          {pending.kind === "stages" && (
            <ThemedText type="small">
              {stageLabel(pending.stage)} · {pending.reason}
            </ThemedText>
          )}
          <Button
            label={t("common.retry")}
            disabled={busy || !!initial.error}
            onPress={() => submit(pending)}
          />
          {reviewed && (
            <Button
              label={t("ipProduction.checked")}
              disabled={busy}
              onPress={() => setConfirm(true)}
            />
          )}
          {confirm && (
            <>
              <ThemedText>{t("ipProduction.clearHint")}</ThemedText>
              <Button
                label={t("ipProduction.confirmClear")}
                disabled={busy}
                onPress={() => {
                  try {
                    outbox.clear(pending.clientKey);
                    setPending(null);
                    setConfirm(false);
                    setError("");
                  } catch (e) {
                    failure(e);
                  }
                }}
              />
              <Button
                label={t("common.cancel")}
                disabled={busy}
                onPress={() => setConfirm(false)}
              />
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}
