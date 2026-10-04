import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { ChannelVideos } from "./channel-videos";
import { ZodError } from "zod";
import { useAuth, useAuthGate } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";
import {
  changeChannelSubmission,
  fetchChannelSubmissions,
  fetchSubmissionWorks,
  type ChannelAction,
  type ChannelPage,
  type ChannelScope,
  type SubmissionWork,
} from "./channel-submissions-api";

export function ChannelSubmissions({ ipId }: { ipId: string }) {
  const { generation, status } = useAuth();
  const locale = useLocale();
  return (
    <Panel
      key={JSON.stringify([ipId, generation, locale])}
      scope={{ ipId, generation, locale }}
      signedIn={status === "authenticated"}
    />
  );
}
function Panel({ scope, signedIn }: { scope: ChannelScope; signedIn: boolean }) {
  const t = useTranslations(),
    theme = useTheme(),
    gate = useAuthGate(),
    router = useRouter();
  const active = useScreenActive();
  const live = useRef(false),
    foreground = useRef(false),
    writing = useRef(false);
  const read = useRef<AbortController | null>(null),
    workRead = useRef<AbortController | null>(null);
  const cursors = useRef(new Set<string>()),
    workCursors = useRef(new Set<string>());
  const [page, setPage] = useState<ChannelPage>();
  const [loading, setLoading] = useState(true),
    [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [needsRefresh, setNeedsRefresh] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false),
    [selected, setSelected] = useState("");
  const [choices, setChoices] = useState<{ items: SubmissionWork[]; nextCursor?: string | null }>();
  const [workLoading, setWorkLoading] = useState(false),
    [workError, setWorkError] = useState<string | null>(null);
  const current = () => live.current && getAuthGeneration() === scope.generation;
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      read.current?.abort();
      workRead.current?.abort();
    };
  }, []);
  useLayoutEffect(() => {
    foreground.current = active;
    return () => {
      foreground.current = false;
    };
  }, [active]);
  const reason = (cause: unknown) =>
    cause instanceof Error && !(cause instanceof ZodError) && cause.message
      ? cause.message
      : t("channelSubmissions.failed");
  async function load(more = false) {
    if (!current() || !foreground.current || writing.current || read.current) return;
    const cursor = more ? (page?.nextCursor ?? null) : null;
    if (more && !cursor) return;
    const token = new AbortController();
    read.current = token;
    setLoading(true);
    setError(null);
    if (!more) setNeedsRefresh(true);
    try {
      const value = await fetchChannelSubmissions(scope, cursor, token.signal);
      if (!current() || read.current !== token || token.signal.aborted) return;
      if (more && value.nextCursor && cursors.current.has(value.nextCursor))
        throw new Error(t("channelSubmissions.failed"));
      if (!more) cursors.current.clear();
      if (cursor) cursors.current.add(cursor);
      setPage({
        ...value,
        items: [
          ...new Map(
            [...(more && page ? page.items : []), ...value.items].map((item) => [item.workId, item])
          ).values(),
        ],
      });
      setNeedsRefresh(false);
    } catch (cause) {
      if (current() && !token.signal.aborted) setError(reason(cause));
    } finally {
      if (current() && read.current === token) {
        read.current = null;
        setLoading(false);
      }
    }
  }
  async function loadWorks(more = false) {
    if (!current() || !foreground.current || !signedIn || workRead.current) return;
    const cursor = more ? (choices?.nextCursor ?? null) : null;
    if (more && !cursor) return;
    const token = new AbortController();
    workRead.current = token;
    setWorkLoading(true);
    setWorkError(null);
    try {
      const value = await fetchSubmissionWorks(scope, cursor, token.signal);
      if (!current() || token.signal.aborted) return;
      if (more && value.nextCursor && workCursors.current.has(value.nextCursor))
        throw new Error(t("channelSubmissions.failed"));
      if (!more) workCursors.current.clear();
      if (cursor) workCursors.current.add(cursor);
      setChoices({
        ...value,
        items: [
          ...new Map(
            [...(more && choices ? choices.items : []), ...value.items].map((item) => [
              item.id,
              item,
            ])
          ).values(),
        ],
      });
    } catch (cause) {
      if (current() && !token.signal.aborted) setWorkError(reason(cause));
    } finally {
      if (current() && workRead.current === token) {
        workRead.current = null;
        setWorkLoading(false);
      }
    }
  }
  const refresh = useEffectEvent(() => {
    void load();
    if (choosing) void loadWorks();
  });
  useEffect(() => {
    let cancelled = false;
    if (active)
      queueMicrotask(() => {
        if (!cancelled) refresh();
      });
    return () => {
      cancelled = true;
      read.current?.abort();
      read.current = null;
      workRead.current?.abort();
      workRead.current = null;
    };
  }, [active]);
  async function change(action: ChannelAction) {
    if (
      !current() ||
      !foreground.current ||
      writing.current ||
      read.current ||
      needsRefresh ||
      !page
    )
      return;
    if (!signedIn) {
      gate.requireAuth();
      return;
    }
    if (action.kind !== "submit" && !page.canManage) return;
    if (
      action.kind === "submit" &&
      (!page.open || !choices?.items.some((item) => item.id === action.workId))
    )
      return;
    writing.current = true;
    setPending(true);
    setError(null);
    setMutationError(null);
    setNeedsRefresh(true);
    try {
      await changeChannelSubmission(scope, action);
      if (current()) {
        setChoosing(false);
        setSelected("");
      }
    } catch (cause) {
      if (current()) setMutationError(reason(cause));
    } finally {
      writing.current = false;
      if (current()) {
        setPending(false);
        // Reconcile from a read; never repeat a submission or review after an uncertain reply.
        if (foreground.current) void load();
      }
    }
  }
  const busy = loading || pending || needsRefresh;
  if (!active || (page && !page.community && !error)) return null;
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("channelSubmissions.title")}</ThemedText>
      {(loading || pending) && (
        <ActivityIndicator accessibilityLabel={t("channelSubmissions.loading")} />
      )}
      {mutationError && (
        <ThemedText type="small" accessibilityRole="alert">
          {mutationError}
        </ThemedText>
      )}
      {error && (
        <ThemedText type="small" accessibilityRole="alert">
          {error}
        </ThemedText>
      )}
      {(error || mutationError || (!loading && !pending && needsRefresh)) && (
        <ActionButton
          label={t("channelSubmissions.refresh")}
          onPress={() => {
            setMutationError(null);
            void load();
          }}
          disabled={loading || pending}
        />
      )}
      {page?.community && (
        <>
          <ChannelVideos scope={scope} />
          <ThemedText type="small" themeColor="textSecondary">
            {t(page.open ? "channelSubmissions.open" : "channelSubmissions.closed")}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t("channelSubmissions.description")}
          </ThemedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {page.canManage && (
              <ActionButton
                label={t(page.open ? "channelSubmissions.close" : "channelSubmissions.enable")}
                onPress={() => void change({ kind: "settings", open: !page.open })}
                disabled={busy}
              />
            )}
            {page.open && (
              <ActionButton
                label={t(choosing ? "common.cancel" : "channelSubmissions.submit")}
                onPress={() => {
                  if (!signedIn) {
                    gate.requireAuth();
                    return;
                  }
                  setChoosing(!choosing);
                  if (!choosing) void loadWorks();
                }}
                disabled={busy}
              />
            )}
          </View>
          {choosing && page.open && (
            <View style={{ gap: 8 }}>
              <ThemedText type="small">{t("channelSubmissions.choose")}</ThemedText>
              {workLoading && (
                <ActivityIndicator accessibilityLabel={t("channelSubmissions.loading")} />
              )}
              {workError && (
                <ThemedText type="small" accessibilityRole="alert">
                  {workError}
                </ThemedText>
              )}
              {workError && (
                <ActionButton
                  label={t("channelSubmissions.retry")}
                  onPress={() => void loadWorks()}
                  disabled={workLoading || pending}
                />
              )}
              {!workLoading && !workError && choices && !choices.items.length && (
                <ThemedText type="small">{t("channelSubmissions.noWorks")}</ThemedText>
              )}
              <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                {choices?.items.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="radio"
                    accessibilityState={{
                      checked: selected === item.id,
                      disabled: busy || workLoading,
                    }}
                    disabled={busy || workLoading}
                    onPress={() => setSelected(item.id)}
                    style={{
                      minHeight: 44,
                      justifyContent: "center",
                      padding: 8,
                      borderRadius: 8,
                      backgroundColor:
                        selected === item.id ? theme.backgroundSelected : theme.background,
                    }}
                  >
                    <ThemedText type={selected === item.id ? "smallBold" : "small"}>
                      {item.title}
                    </ThemedText>
                  </Pressable>
                ))}
              </ScrollView>
              {choices?.nextCursor && (
                <ActionButton
                  label={t("channelSubmissions.more")}
                  onPress={() => void loadWorks(true)}
                  disabled={workLoading || pending}
                />
              )}
              {
                <ActionButton
                  label={t("channelSubmissions.send")}
                  onPress={() => void change({ kind: "submit", workId: selected })}
                  disabled={
                    busy ||
                    workLoading ||
                    !!workError ||
                    !choices?.items.some((item) => item.id === selected)
                  }
                />
              }
            </View>
          )}
          {!page.items.length && (
            <ThemedText type="small" themeColor="textSecondary">
              {t("channelSubmissions.empty")}
            </ThemedText>
          )}
          {page.items.map((item) => (
            <View
              key={item.workId}
              style={{ gap: 4, borderTopWidth: 1, borderColor: theme.border, paddingTop: 8 }}
            >
              <Pressable
                accessibilityRole="link"
                onPress={() => router.push(toHref(`/ip/${encodeURIComponent(item.workId)}`))}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <ThemedText type="smallBold">{item.title}</ThemedText>
              </Pressable>
              <ThemedText type="small" themeColor="textSecondary">
                {t(`channelSubmissions.${item.status}`)}
              </ThemedText>
              {page.canManage && item.status === "pending" && (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(["approved", "rejected"] as const).map((status) => (
                    <View key={status}>
                      {
                        <ActionButton
                          label={t(
                            status === "approved"
                              ? "channelSubmissions.approve"
                              : "channelSubmissions.reject"
                          )}
                          onPress={() =>
                            void change({
                              kind: "review",
                              workId: item.workId,
                              status,
                              expectedVersion: item.version,
                            })
                          }
                          disabled={busy}
                        />
                      }
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))}
          {page.nextCursor && (
            <ActionButton
              label={t("channelSubmissions.more")}
              onPress={() => void load(true)}
              disabled={busy}
            />
          )}
        </>
      )}
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 44,
        justifyContent: "center",
        paddingHorizontal: 10,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}
