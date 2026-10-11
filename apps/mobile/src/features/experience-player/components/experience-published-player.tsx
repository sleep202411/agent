import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";

import tokens from "@/config/theme-tokens.json";
import { useAuth } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useAppActiveChange } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { ApiRequestError } from "@/lib/api-client";
import type { ExperiencePlayerProps } from "./experience-player";
import { ExperiencePlayerWithAccess } from "./experience-player-with-access";
import { getStorySaveChannel, type StorySaveStatus } from "../lib/story-save-channel";
import {
  clearStorySaveSlots,
  resolveStorySave,
  type StorySaveResolution,
} from "../lib/story-save-resolution";

export type ExperiencePublishedPlayerProps = Omit<
  ExperiencePlayerProps,
  "runtime" | "access" | "entryCheckpoint" | "onCheckpoint" | "onRestartRequested"
> & {
  runtime: ExperienceRuntimeManifest;
  chapterId: string;
  availableChapterIds: readonly string[];
  explicitChapter: boolean;
  onSavedChapter: (chapterId: string) => void;
};

/** Account/build/chapter identity owns both restored state and the mounted player. */
export function ExperiencePublishedPlayer(props: ExperiencePublishedPlayerProps) {
  const auth = useAuth();
  const accountId =
    auth.status === "authenticated" ? String(auth.user?.userId ?? auth.user?.id ?? "") : null;
  if (auth.status === "hydrating" || (auth.status === "authenticated" && !accountId))
    return <Loading label={props.copy.starting} />;
  return (
    <SavedPlayer
      key={JSON.stringify([
        accountId,
        auth.generation,
        props.runtime.gameId,
        props.runtime.buildId,
        props.runtime.contentVersion,
        props.chapterId,
        props.availableChapterIds,
      ])}
      {...props}
      accountId={accountId}
    />
  );
}

type Resolution = StorySaveResolution | { phase: "resolving" } | { phase: "error"; error: string };
function SavedPlayer({
  accountId,
  chapterId,
  availableChapterIds,
  explicitChapter,
  onSavedChapter,
  runtime: inputRuntime,
  ...playerProps
}: ExperiencePublishedPlayerProps & { accountId: string | null }) {
  const t = useTranslations();
  const [runtime] = useState(inputRuntime);
  const [bootstrap] = useState({ availableChapterIds, explicitChapter });
  const [channel] = useState(() =>
    accountId ? getStorySaveChannel(accountId, runtime.gameId, chapterId) : null
  );
  const [resolution, setResolution] = useState<Resolution>({ phase: "resolving" });
  const [status, setStatus] = useState<StorySaveStatus>({ phase: "idle", error: null });
  const [attempt, setAttempt] = useState(0);
  const [playerGeneration, setPlayerGeneration] = useState(0);
  const currentPlayerGeneration = useRef(0);
  const [busy, setBusy] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const reload = useRef(false);
  const mounted = useRef(false);
  const ready = useRef(false);
  const restarting = useRef(false);
  const request = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPutAt = useRef(0);
  const cancelTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const owns = useCallback(() => mounted.current && (!channel || channel.ownsSession()), [channel]);
  useLayoutEffect(() => {
    ready.current = resolution.phase === "ready" && !busy;
  }, [resolution.phase, busy]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      cancelTimer();
      if (channel?.ownsSession() && !restarting.current) void channel.flush().catch(() => {});
    };
  }, [channel, cancelTimer]);
  useEffect(() => channel?.subscribe(setStatus), [channel]);
  const redirect = useEffectEvent(onSavedChapter);
  const loadFailed = useEffectEvent(() => t("play.saveLoadFailed"));
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    void resolveStorySave({
      accountId,
      runtime,
      chapterId,
      ...bootstrap,
      reload: reload.current,
      signal: controller.signal,
    }).then(
      (result) => {
        if (!owns() || controller.signal.aborted) return;
        reload.current = false;
        setResolution(result);
      },
      (error: unknown) => {
        if (!owns() || controller.signal.aborted) return;
        setResolution({
          phase: "error",
          error: error instanceof Error ? error.message : loadFailed(),
        });
      }
    );
    return () => controller.abort();
  }, [accountId, runtime, chapterId, bootstrap, attempt, owns]);
  useEffect(() => {
    if (resolution.phase === "redirecting" && playerProps.active !== false)
      redirect(resolution.chapterId);
  }, [resolution, playerProps.active]);
  const flush = useCallback(() => {
    cancelTimer();
    if (!channel || !owns() || restarting.current) return;
    lastPutAt.current = Date.now();
    void channel.flush().catch(() => {});
  }, [channel, owns, cancelTimer]);
  useAppActiveChange((active) => {
    if (!active) flush();
  });
  const onCheckpoint: NonNullable<ExperiencePlayerProps["onCheckpoint"]> = useCallback(
    (checkpoint, reason) => {
      if (
        !channel ||
        !owns() ||
        !ready.current ||
        restarting.current ||
        currentPlayerGeneration.current !== playerGeneration
      )
        return;
      channel.replace({
        contentVersion: runtime.contentVersion,
        state: { ...checkpoint.state },
        events: checkpoint.events.map((event) => ({ ...event })),
        ...(checkpoint.playback ? { playback: { ...checkpoint.playback } } : {}),
        ...(checkpoint.journey ? { journey: checkpoint.journey } : {}),
      });
      const elapsed = Date.now() - lastPutAt.current;
      if (reason !== "progress" || elapsed >= 3000) flush();
      else if (timer.current === null) timer.current = setTimeout(flush, 3000 - elapsed);
    },
    [channel, owns, runtime.contentVersion, flush, playerGeneration]
  );
  const retryRead = (discardPending: boolean) => {
    cancelTimer();
    ready.current = false;
    reload.current = discardPending;
    setRestartError(null);
    setResolution({ phase: "resolving" });
    currentPlayerGeneration.current += 1;
    setPlayerGeneration(currentPlayerGeneration.current);
    setAttempt((value) => value + 1);
  };
  const restart = async () => {
    if (restarting.current || !owns()) return;
    restarting.current = true;
    ready.current = false;
    cancelTimer();
    setBusy(true);
    setRestartError(null);
    try {
      if (accountId)
        await clearStorySaveSlots({
          accountId,
          gameId: runtime.gameId,
          chapterIds: [
            chapterId,
            ...(resolution.phase === "incompatible" ? [resolution.savedChapterId] : []),
          ],
          signal: request.current?.signal,
        });
      if (!owns()) return;
      currentPlayerGeneration.current += 1;
      setPlayerGeneration(currentPlayerGeneration.current);
      setResolution({ phase: "ready", checkpoint: null });
    } catch (error) {
      if (!owns()) return;
      setRestartError(error instanceof Error ? error.message : t("play.saveRestartFailed"));
      if (error instanceof ApiRequestError && error.status === 409)
        setResolution({ phase: "error", error: error.message });
    } finally {
      if (owns()) {
        restarting.current = false;
        setBusy(false);
      }
    }
  };
  const conflict = status.phase === "conflict";
  if (resolution.phase === "resolving" || resolution.phase === "redirecting")
    return <Loading label={playerProps.copy.starting} />;
  if (resolution.phase !== "ready" || conflict) {
    const incompatible = resolution.phase === "incompatible";
    return (
      <View style={styles.recovery}>
        <ScrollView
          contentContainerStyle={styles.recoveryContent}
          style={styles.recoveryScroll}
          accessibilityRole="alert"
        >
          <ThemedText type="smallBold" style={styles.text}>
            {t(
              conflict
                ? "play.saveConflict"
                : incompatible
                  ? "play.saveUnavailableTitle"
                  : "play.saveLoadFailed"
            )}
          </ThemedText>
          <ThemedText type="small" style={styles.muted}>
            {conflict
              ? t("play.saveConflictHint")
              : incompatible
                ? t(
                    resolution.reason === "chapter"
                      ? "play.saveChapterUnavailable"
                      : "play.saveStateUnavailable"
                  )
                : resolution.phase === "error"
                  ? resolution.error
                  : ""}
          </ThemedText>
          {incompatible && (
            <ThemedText type="small" style={styles.muted}>
              {t("play.savePreserved")}
            </ThemedText>
          )}
          {restartError && (
            <ThemedText type="small" style={styles.text}>
              {restartError}
            </ThemedText>
          )}
          <Action
            disabled={busy}
            label={
              busy
                ? playerProps.copy.starting
                : conflict
                  ? t("play.reloadSave")
                  : incompatible
                    ? playerProps.copy.restart
                    : t("common.retry")
            }
            onPress={() =>
              conflict ? retryRead(true) : incompatible ? void restart() : retryRead(false)
            }
          />
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={styles.host}>
      <ExperiencePlayerWithAccess
        {...playerProps}
        key={playerGeneration}
        runtime={runtime}
        accessMode="published"
        chapterId={chapterId}
        copy={
          resolution.checkpoint
            ? { ...playerProps.copy, start: playerProps.copy.continue }
            : playerProps.copy
        }
        active={playerProps.active !== false && !busy}
        entryCheckpoint={resolution.checkpoint ?? undefined}
        onCheckpoint={onCheckpoint}
        onRestartRequested={() => void restart()}
      />
      {accountId && !restartError && ["pending", "saving", "saved"].includes(status.phase) && (
        <View pointerEvents="none" style={styles.saveStatus}>
          <ThemedText type="small" style={styles.muted} accessibilityLiveRegion="polite">
            {t(status.phase === "saved" ? "play.saveSaved" : "play.saveSaving")}
          </ThemedText>
        </View>
      )}
      {(status.phase === "error" || restartError) && (
        <View style={styles.notice} accessibilityRole="alert">
          <ThemedText type="small" style={styles.text}>
            {restartError ?? status.error ?? t("play.saveWriteFailed")}
          </ThemedText>
          <Action
            label={t("common.retry")}
            disabled={busy}
            onPress={() => (restartError ? void restart() : flush())}
          />
        </View>
      )}
    </View>
  );
}
function Loading({ label }: { label: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color="#FFFFFF" />
      <ThemedText type="small" style={styles.muted}>
        {label}
      </ThemedText>
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
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.action, disabled && styles.disabled]}
    >
      <ThemedText type="smallBold" style={styles.text}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

// Match the existing native player chrome. NativeWind's hoisted type/runtime
// resolves a different React Native version in this workspace; keep this surface
// on the player's established StyleSheet path and shared design tokens.
const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: "#000000" },
  recovery: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000000",
    padding: 20,
  },
  recoveryScroll: { width: "100%", maxWidth: 448, flexGrow: 0 },
  recoveryContent: { gap: 12, paddingVertical: 16 },
  text: { color: "#FFFFFF" },
  muted: { color: "rgba(255,255,255,0.65)" },
  saveStatus: {
    position: "absolute",
    bottom: 12,
    left: 12,
    padding: 6,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.75)",
  },
  notice: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
    borderRadius: 8,
    backgroundColor: tokens.colors.dark.surface,
    padding: 12,
    gap: 8,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#000000",
    padding: 16,
  },
  action: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: tokens.colors.brand[500],
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  disabled: { opacity: 0.5 },
});
