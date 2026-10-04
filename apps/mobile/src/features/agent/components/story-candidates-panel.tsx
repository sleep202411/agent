import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { uuid } from "expo-modules-core";
import { useIsFocused } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { useStoryChapterContext } from "../context/story-chapter-context";
import {
  storyCandidates,
  type CandidateScope,
  type CandidateState,
  type CandidateRemoval,
} from "../api/story-candidates-api";

export function StoryCandidatesEntry() {
  const context = useStoryChapterContext(),
    auth = useAuth(),
    active = useIsFocused(),
    t = useTranslations();
  const [open, setOpen] = useState(false);
  if (auth.status !== "authenticated" || !context.capabilities.includes("story.read")) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={context.loading || !!context.error}
        onPress={() => setOpen(true)}
        style={{ padding: 10 }}
      >
        <ThemedText type="small">{t("storyCandidates.title")}</ThemedText>
      </Pressable>
      {open && active && !context.loading && !context.error && (
        <StoryCandidatesPanel
          key={`${context.projectId}:${auth.generation}`}
          scope={{ projectId: context.projectId, generation: auth.generation }}
          userId={String(auth.user?.userId ?? auth.user?.id ?? "")}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}
export function StoryCandidatesPanel({
  scope,
  userId,
  close,
}: {
  scope: CandidateScope;
  userId: string;
  close: () => void;
}) {
  const { projectId, generation } = scope;
  const client = useMemo(
    () => storyCandidates({ projectId, generation }, userId),
    [projectId, generation, userId]
  );
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const [state, setState] = useState<CandidateState>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState<"all" | "image" | "video" | "audio">("all");
  const life = useRef<AbortController | null>(null),
    locked = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    life.current = c;
    void client
      .load(c.signal)
      .then((value) => {
        if (!c.signal.aborted) setState(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setBusy(false);
      });
    return () => {
      c.abort();
    };
  }, [client, revision]);
  const remove = async (command: CandidateRemoval) => {
    const signal = life.current?.signal;
    if (!signal || signal.aborted || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const next = await client.remove(command, signal);
      if (!signal.aborted) setState(next);
    } catch (e) {
      if (!signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
        try {
          const pending = client.pending();
          setState((value) => value && { ...value, pending });
        } catch {
          /* Keep the original failure. */
        }
      }
    } finally {
      locked.current = false;
      if (!signal.aborted) setBusy(false);
    }
  };
  const items = state?.items.filter((item) => filter === "all" || item.asset.kind === filter) ?? [];
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.background }}
        contentContainerStyle={{
          padding: 16,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
          gap: 12,
        }}
      >
        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
        >
          <ThemedText type="smallBold">{t("storyCandidates.title")}</ThemedText>
          <Action label={t("agent.close")} run={close} />
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {t("storyCandidates.help")}
        </ThemedText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
          {(["all", "image", "video", "audio"] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: filter === value }}
              onPress={() => setFilter(value)}
              style={{ paddingVertical: 12 }}
            >
              <ThemedText
                type="smallBold"
                style={{ color: filter === value ? theme.brand : theme.text }}
              >
                {t(`storyCandidates.${value}`)}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        {busy && <ActivityIndicator />}
        {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
        {state?.pending && (
          <View>
            <ThemedText type="small">{t("storyCandidates.pending")}</ThemedText>
            <Action
              label={t("storyCandidates.retryRemove")}
              run={() => void remove(state.pending!)}
              disabled={busy || !state.canEdit}
            />
          </View>
        )}
        {!busy && state && !items.length && (
          <ThemedText type="small">{t("storyCandidates.empty")}</ThemedText>
        )}
        {items.map((item, index) => (
          <View
            key={item.asset.id}
            style={{
              padding: 12,
              borderRadius: 8,
              backgroundColor: theme.backgroundElement,
              gap: 8,
            }}
          >
            <ThemedText type="smallBold">
              {t(
                `storyCandidates.${["image", "video", "audio"].includes(item.asset.kind) ? (item.asset.kind as "image" | "video" | "audio") : "other"}`
              )}{" "}
              {index + 1}
            </ThemedText>
            {item.asset.kind === "image" &&
              item.asset.status === "ready" &&
              item.asset.moderationStatus !== "blocked" &&
              item.asset.previewUrl?.startsWith("https://") && (
                <Image
                  source={{ uri: item.asset.previewUrl }}
                  contentFit="contain"
                  style={{ height: 140, width: "100%" }}
                />
              )}
            <ThemedText type="small" themeColor="textSecondary">
              {item.asset.contentType}
            </ThemedText>
            {state?.canEdit && (
              <Action
                label={t("storyCandidates.remove")}
                run={() =>
                  Alert.alert(t("storyCandidates.remove"), t("storyCandidates.removeHelp"), [
                    { text: t("common.cancel"), style: "cancel" },
                    {
                      text: t("storyCandidates.remove"),
                      style: "destructive",
                      onPress: () =>
                        void remove({ clientKey: uuid.v4(), mediaAssetId: item.asset.id }),
                    },
                  ])
                }
                disabled={busy || !!state.pending}
              />
            )}
          </View>
        ))}
        <Action
          label={t(error ? "common.retry" : "storyCandidates.refresh")}
          run={() => {
            setBusy(true);
            setError(undefined);
            setState(undefined);
            setRevision((value) => value + 1);
          }}
          disabled={busy}
        />
      </ScrollView>
    </Modal>
  );
}

function Action({
  label,
  run,
  disabled = false,
}: {
  label: string;
  run: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={run}
      style={{ paddingVertical: 12, opacity: disabled ? 0.45 : 1 }}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}
