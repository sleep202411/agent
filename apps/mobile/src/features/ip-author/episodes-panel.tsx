import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { useIsFocused } from "expo-router";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ApiRequestError } from "@/lib/api-client";
import { invalidateBrowse } from "@/data/browse-refresh";
import { ConversationVideo } from "@/features/services/conversation-video";
import {
  fetchAuthorEpisodes,
  episodeOutbox,
  episodeCommand,
  episodeMatches,
  mutateAuthorEpisode,
  type AuthorEpisode,
  type EpisodeCommand,
  type EpisodeSnapshot,
} from "./episodes-api";
type Props = {
  ipId: string;
  userId: string;
  generation: number;
  onOpenMedia?: (episodeId: string) => void;
};
export function IpEpisodesPanel(props: Props) {
  const focused = useIsFocused();
  return focused && getAuthGeneration() === props.generation ? (
    <Session key={JSON.stringify(props)} {...props} />
  ) : null;
}
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
      onPress={onPress}
      disabled={disabled}
      style={{ padding: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
type Draft = {
  episodeId: string;
  title: string;
  summary: string;
  duration: string;
  isFreePreview: boolean;
  status: "" | "draft" | "hidden";
  version: number;
  sourceLocale: EpisodeSnapshot["sourceLocale"];
};
function Session({ ipId, userId, generation, onOpenMedia }: Props) {
  const active = useScreenActive();
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(ipId, true);
  const [outbox] = useState(() => episodeOutbox(ipId, userId, generation));
  const [initial] = useState(() => {
    try {
      return { pending: outbox.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState<EpisodeCommand | null>(initial.pending ?? null),
    [snapshot, setSnapshot] = useState<EpisodeSnapshot>();
  const [draft, setDraft] = useState<Draft>(),
    [deleting, setDeleting] = useState<string>(),
    [preview, setPreview] = useState<string>();
  const [error, setError] = useState(initial.error),
    [loading, setLoading] = useState(true),
    [saved, setSaved] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void fetchAuthorEpisodes(ipId, generation, c.signal)
      .then((value) => {
        if (!c.signal.aborted) setSnapshot(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e.message ?? e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [ipId, generation]);
  const frozen = op.busy || !!pending || !!initial.error;
  const failure = (e: unknown) => {
    setError(String(e instanceof Error ? e.message : e));
    if (e instanceof ApiRequestError && [401, 403, 404].includes(e.status)) {
      setSnapshot(undefined);
      setDraft(undefined);
      setPreview(undefined);
      setDeleting(undefined);
    }
  };
  const refresh = () => {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    void op.run(
      () => fetchAuthorEpisodes(ipId, generation, signal),
      (value) => {
        setSnapshot(value);
        setDraft(undefined);
        setDeleting(undefined);
        setPreview(undefined);
        setError(initial.error);
        setSaved(false);
      },
      failure
    );
  };
  const run = (input: EpisodeCommand) => {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    setError("");
    setSaved(false);
    setPreview(undefined);
    void op.run(
      async () => {
        const command = episodeCommand.parse(input);
        outbox.save(command);
        setPending(command);
        try {
          const value = await mutateAuthorEpisode(ipId, generation, command, signal);
          outbox.clear(command.clientKey);
          return value;
        } catch (e) {
          if (e instanceof ApiRequestError && [400, 401, 403, 404, 409, 422].includes(e.status)) {
            outbox.clear(command.clientKey);
            setPending(null);
            setDraft(undefined);
            setDeleting(undefined);
          }
          throw e;
        }
      },
      (value) => {
        setSnapshot(value);
        setDraft(undefined);
        setDeleting(undefined);
        setPending(null);
        setSaved(true);
        invalidateBrowse();
      },
      failure
    );
  };
  const edit = (item: AuthorEpisode) => {
    if (!snapshot) return;
    setDeleting(undefined);
    setSaved(false);
    setError("");
    setDraft({
      episodeId: item.id,
      title: item.title,
      summary: item.summary ?? "",
      duration: item.durationSeconds === null ? "" : String(item.durationSeconds),
      isFreePreview: item.isFreePreview,
      status: "",
      version: snapshot.version,
      sourceLocale: snapshot.sourceLocale,
    });
  };
  const parsed = draft
    ? episodeCommand.safeParse({
        clientKey: "00000000-0000-4000-8000-000000000000",
        episodeId: draft.episodeId,
        expectedVersion: draft.version,
        sourceLocale: draft.sourceLocale,
        action: "edit",
        data: {
          title: draft.title,
          summary: draft.summary,
          durationSeconds: draft.duration.trim() ? Number(draft.duration) : null,
          isFreePreview: draft.isFreePreview,
          ...(draft.status ? { status: draft.status } : {}),
        },
      })
    : null;
  const target = snapshot?.episodes.find((item) => item.id === draft?.episodeId);
  if (!active) return null;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {(loading || op.busy) && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved && <ThemedText>{t("ipEpisodes.saved")}</ThemedText>}
      <Button label={t("thread.refresh")} onPress={refresh} disabled={loading || op.busy} />
      {snapshot && (
        <>
          <ThemedText>
            {t("ipAuthor.source")}: {snapshot.sourceLocale}
          </ThemedText>
          {!snapshot.episodes.length && <ThemedText>{t("ipEpisodes.empty")}</ThemedText>}
          {snapshot.episodes.map((item) => (
            <View
              key={item.id}
              style={{
                gap: 8,
                padding: 12,
                borderRadius: 8,
                backgroundColor: theme.backgroundElement,
              }}
            >
              <ThemedText type="smallBold">
                {item.episodeNo}. {item.title}
              </ThemedText>
              <ThemedText>{item.summary}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {item.status}
              </ThemedText>
              {item.mediaAsset?.url &&
                (preview === item.id ? (
                  <View style={{ height: 220 }}>
                    <ConversationVideo
                      url={item.mediaAsset.url}
                      onRetry={() => setPreview(undefined)}
                    />
                  </View>
                ) : (
                  <Button
                    label={t("ipEpisodes.preview")}
                    onPress={() => setPreview(item.id)}
                    disabled={op.busy}
                  />
                ))}
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                <Button label={t("ipEpisodes.edit")} onPress={() => edit(item)} disabled={frozen} />
                {onOpenMedia && (
                  <Button
                    label={t("ipEpisodeMedia.heading")}
                    onPress={() => onOpenMedia(item.id)}
                    disabled={frozen}
                  />
                )}
                <Button
                  label={t("ipEpisodes.delete")}
                  onPress={() => {
                    setDraft(undefined);
                    setDeleting(item.id);
                  }}
                  disabled={frozen}
                />
              </View>
              {deleting === item.id && (
                <View>
                  <ThemedText>{t("ipEpisodes.deleteConfirm")}</ThemedText>
                  <Button
                    label={t("ipEpisodes.confirmDelete")}
                    disabled={frozen}
                    onPress={() =>
                      run({
                        clientKey: uuid.v4(),
                        action: "delete",
                        episodeId: item.id,
                        expectedVersion: snapshot.version,
                        sourceLocale: snapshot.sourceLocale,
                      })
                    }
                  />
                  <Button
                    label={t("common.cancel")}
                    onPress={() => setDeleting(undefined)}
                    disabled={frozen}
                  />
                </View>
              )}
              {draft?.episodeId === item.id && (
                <View style={{ gap: 8 }}>
                  {(["title", "summary", "duration"] as const).map((field) => (
                    <View key={field}>
                      <ThemedText>{t(`ipEpisodes.${field}`)}</ThemedText>
                      <TextInput
                        accessibilityLabel={t(`ipEpisodes.${field}`)}
                        value={draft[field]}
                        editable={!frozen}
                        multiline={field === "summary"}
                        keyboardType={field === "duration" ? "numeric" : "default"}
                        maxLength={field === "title" ? 80 : field === "summary" ? 800 : 5}
                        onChangeText={(value) => setDraft({ ...draft, [field]: value })}
                        style={{ color: theme.text, padding: 12 }}
                      />
                    </View>
                  ))}
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: draft.isFreePreview, disabled: frozen }}
                    disabled={frozen}
                    onPress={() => setDraft({ ...draft, isFreePreview: !draft.isFreePreview })}
                    style={{ padding: 12 }}
                  >
                    <ThemedText>
                      {draft.isFreePreview ? "☑ " : "☐ "}
                      {t("ipEpisodes.freePreview")}
                    </ThemedText>
                  </Pressable>
                  {(["", "draft", "hidden"] as const).map((status) => (
                    <Pressable
                      key={status}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: draft.status === status, disabled: frozen }}
                      disabled={frozen}
                      onPress={() => setDraft({ ...draft, status })}
                      style={{ padding: 12 }}
                    >
                      <ThemedText>
                        {draft.status === status ? "● " : "○ "}
                        {t(`ipEpisodes.${status || "keepStatus"}`)}
                      </ThemedText>
                    </Pressable>
                  ))}
                  <Button
                    label={t("ipEpisodes.save")}
                    disabled={
                      frozen ||
                      !parsed?.success ||
                      (!!target &&
                        parsed.data.action === "edit" &&
                        episodeMatches(target, parsed.data.data))
                    }
                    onPress={() => {
                      if (parsed?.success) run({ ...parsed.data, clientKey: uuid.v4() });
                    }}
                  />
                  <Button
                    label={t("common.cancel")}
                    onPress={() => setDraft(undefined)}
                    disabled={frozen}
                  />
                </View>
              )}
            </View>
          ))}
          {pending && (
            <View>
              <ThemedText>{t("ipEpisodes.pending")}</ThemedText>
              <ThemedText>
                {t(pending.action === "delete" ? "ipEpisodes.delete" : "ipEpisodes.save")}:{" "}
                {pending.action === "edit"
                  ? pending.data.title
                  : snapshot.episodes.find((item) => item.id === pending.episodeId)?.title}
              </ThemedText>
              <Button
                label={t("common.retry")}
                onPress={() => run(pending)}
                disabled={op.busy || !!initial.error}
              />
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
