import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { uuid } from "expo-modules-core";
import { MaxContentWidth } from "@/constants/theme";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations, type MessageKey } from "@/i18n";
import { getAuthGeneration } from "@/auth/auth-store";
import type { TimelineScope } from "../api/story-timeline-api";

import {
  storyBatchManagement,
  type ManagedStoryBatch,
  type BatchQuoteCommand,
} from "../api/story-batch-management";

type Props = {
  scope: TimelineScope;
  userId: string;
  assets: { id: string; name: string; version: number; sequenceId?: string }[];
  mode?: "assets" | "storyboard";
  canGenerate: boolean;
  onClose(): void;
};
export function StoryBatchPanel({
  scope,
  userId,
  assets,
  canGenerate,
  onClose,
  mode = "assets",
}: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const active = useScreenActive();
  const client = useMemo(() => storyBatchManagement(scope, userId, mode), [scope, userId, mode]);
  const [rows, setRows] = useState<ManagedStoryBatch[]>([]);
  const [selected, setSelected] = useState(() => assets.slice(0, 500).map((asset) => asset.id));
  const [pending, setPending] = useState<BatchQuoteCommand | null>(null);
  const [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now);
  const life = useRef<AbortController | null>(null),
    lock = useRef(false),
    operation = useRef(0);
  const valid = useCallback(
    (signal: AbortSignal) => !signal.aborted && scope.generation === getAuthGeneration(),
    [scope.generation]
  );
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    life.current = controller;
    operation.current++;
    lock.current = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const version = operation.current;
        const items = await client.list(controller.signal);
        if (!valid(controller.signal)) return;
        if (!lock.current && operation.current === version) {
          setBusy(false);
          setNow(Date.now());
          setRows(items);
          setPending(client.pending() ?? null);
          setLoaded(true);
        }
        timer = setTimeout(() => void load(), 3000);
      } catch (cause) {
        if (valid(controller.signal)) {
          if (!lock.current) setBusy(false);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, active, revision, valid]);
  const run = async (fn: (signal: AbortSignal) => Promise<ManagedStoryBatch>) => {
    const signal = life.current?.signal;
    if (!canGenerate || !signal || !valid(signal) || lock.current) return;
    const version = ++operation.current;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const row = await fn(signal);
      if (valid(signal)) {
        setRows((old) => [row, ...old.filter((item) => item.id !== row.id)]);
        setPending(client.pending() ?? null);
      }
    } catch (cause) {
      if (valid(signal)) {
        setError(cause instanceof Error ? cause.message : String(cause));
        try {
          setPending(client.pending() ?? null);
        } catch {
          /* Preserve the actionable error. */
        }
      }
    } finally {
      if (operation.current === version) {
        lock.current = false;
        if (valid(signal)) setBusy(false);
      }
    }
  };
  if (!active || scope.generation !== getAuthGeneration()) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView
        contentContainerStyle={{
          width: "100%",
          maxWidth: MaxContentWidth,
          alignSelf: "center",
          padding: 16,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
          gap: 12,
          backgroundColor: theme.background,
        }}
        style={{ backgroundColor: theme.background }}
      >
        <ThemedText type="smallBold">{t("storyBatch.title")}</ThemedText>
        <BatchAction label={t("common.back")} onPress={onClose} disabled={busy} />
        {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
        <BatchAction
          label={t("common.retry")}
          disabled={busy}
          onPress={() => {
            setError(undefined);
            setRevision((value) => value + 1);
          }}
        />
        {(!loaded || busy) && <ActivityIndicator />}
        {canGenerate && (
          <>
            <ThemedText>
              {t(mode === "assets" ? "storyBatch.quoteHelp" : "storyBatch.timelineHelp")}
            </ThemedText>
            {assets.map((asset) => (
              <Pressable
                key={asset.id}
                accessibilityRole="checkbox"
                accessibilityState={{
                  checked: selected.includes(asset.id),
                  disabled: busy || !!pending,
                }}
                disabled={busy || !!pending}
                onPress={() =>
                  setSelected((old) =>
                    old.includes(asset.id)
                      ? old.filter((id) => id !== asset.id)
                      : old.length < 500
                        ? [...old, asset.id]
                        : old
                  )
                }
                style={{ paddingVertical: 8 }}
              >
                <ThemedText>
                  {selected.includes(asset.id) ? "☑ " : "☐ "}
                  {asset.name}
                </ThemedText>
              </Pressable>
            ))}
            {pending ? (
              <>
                <ThemedText>{t("storyBatch.pending")}</ThemedText>
                <BatchAction
                  label={t("storyBatch.discardQuote")}
                  disabled={busy}
                  onPress={() => {
                    try {
                      client.discardQuote();
                      setPending(null);
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : String(cause));
                    }
                  }}
                />
                <BatchAction
                  label={t("common.retry")}
                  disabled={busy}
                  onPress={() => void run((signal) => client.quote(pending, signal))}
                />
              </>
            ) : (
              <BatchAction
                label={t("storyBatch.quote")}
                disabled={busy || !loaded || !selected.length}
                onPress={() =>
                  void run((signal) =>
                    client.quote(
                      {
                        clientKey: uuid.v4(),
                        targets: assets
                          .filter((asset) => selected.includes(asset.id))
                          .map((asset) => ({
                            id: asset.id,
                            expectedVersion: asset.version,
                            ...(asset.sequenceId ? { sequenceId: asset.sequenceId } : {}),
                          })),
                      },
                      signal
                    )
                  )
                }
              />
            )}
          </>
        )}
        {loaded && !rows.length && <ThemedText>{t("storyBatch.empty")}</ThemedText>}
        {rows.map((row) => (
          <View
            key={row.id}
            style={{
              gap: 8,
              padding: 12,
              borderRadius: 8,
              backgroundColor: theme.backgroundElement,
            }}
          >
            <ThemedText type="smallBold">
              {t(
                `storyBatch.status.${row.status === "awaiting_confirmation" && Date.parse(row.quoteExpiresAt) <= now ? "expired" : row.status}` as MessageKey
              )}
            </ThemedText>
            <ThemedText type="small">{row.id}</ThemedText>
            <ThemedText>
              {t("storyBatch.cost")
                .replace("{points}", String(row.totalPoints))
                .replace("{count}", String(row.itemCount))}
            </ThemedText>
            {row.availablePoints !== null && (
              <ThemedText type="small">
                {t("paywall.compute.availableBalance")} · {row.availablePoints}
              </ThemedText>
            )}
            {row.items.map((item) => (
              <View key={item.id}>
                <ThemedText type="small">
                  {assets.find((asset) => asset.id === item.targetId)?.name ?? item.targetId} ·{" "}
                  {item.modelId} · {item.quotedPoints} ·{" "}
                  {t(`agent.generation.itemStatus.${item.status}` as MessageKey)}
                </ThemedText>
                {item.error &&
                typeof item.error === "object" &&
                "message" in item.error &&
                typeof item.error.message === "string" ? (
                  <ThemedText accessibilityRole="alert">{item.error.message}</ThemedText>
                ) : null}
              </View>
            ))}
            {row.blockReason &&
            typeof row.blockReason === "object" &&
            "message" in row.blockReason &&
            typeof row.blockReason.message === "string" ? (
              <ThemedText accessibilityRole="alert">{row.blockReason.message}</ThemedText>
            ) : null}
            {canGenerate && (
              <>
                {row.status === "awaiting_confirmation" && (
                  <BatchAction
                    label={t("storyBatch.confirm")}
                    disabled={busy || Date.parse(row.quoteExpiresAt) <= now}
                    onPress={() => void run((signal) => client.act("confirm", row, signal))}
                  />
                )}
                {["blocked", "failed", "partial_failed"].includes(row.status) && (
                  <BatchAction
                    label={t("storyBatch.resume")}
                    disabled={busy}
                    onPress={() => void run((signal) => client.act("resume", row, signal))}
                  />
                )}
                {row.canCancel &&
                  [
                    "awaiting_confirmation",
                    "blocked",
                    "queued",
                    "running",
                    "failed",
                    "partial_failed",
                  ].includes(row.status) && (
                    <BatchAction
                      label={t("storyBatch.cancel")}
                      disabled={busy}
                      onPress={() => void run((signal) => client.act("cancel", row, signal))}
                    />
                  )}
              </>
            )}
          </View>
        ))}
      </ScrollView>
    </Modal>
  );
}

function BatchAction({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={{ paddingVertical: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="smallBold" style={{ color: theme.brand }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}
