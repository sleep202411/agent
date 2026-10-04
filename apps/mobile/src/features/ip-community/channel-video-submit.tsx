import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { getDocumentAsync } from "expo-document-picker";
import { ZodError } from "zod";
import { useAuth, useAuthGate } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { confirmMobileMediaUpload, type MobileUploadFile } from "@/lib/media-upload";
import { fetchChannelSubmissions, type ChannelScope } from "./channel-submissions-api";
import { channelVideoInput, submitChannelVideo } from "./channel-videos-api";
import { uploadChannelVideo } from "./channel-video-upload";
import { channelVideoDraftStorage, type ChannelVideoDraft } from "./channel-video-draft";

export function ChannelVideoSubmit({
  scope,
  onSubmitted,
}: {
  scope: ChannelScope;
  onSubmitted: () => void;
}) {
  const auth = useAuth(),
    gate = useAuthGate(),
    t = useTranslations();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  if (auth.status !== "authenticated" || !userId)
    return <Action label={t("channelVideos.submit")} onPress={() => gate.requireAuth()} />;
  return (
    <Form
      key={JSON.stringify([scope.ipId, scope.generation, userId])}
      scope={scope}
      userId={userId}
      onSubmitted={onSubmitted}
    />
  );
}
function Form({
  scope,
  userId,
  onSubmitted,
}: {
  scope: ChannelScope;
  userId: string;
  onSubmitted: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    active = useScreenActive();
  const storage = useMemo(() => channelVideoDraftStorage(userId, scope.ipId), [userId, scope.ipId]);
  const [restored] = useState(() => {
    try {
      return { draft: storage.read(), error: null };
    } catch (cause) {
      return { draft: null, error: cause instanceof Error ? cause.message : "" };
    }
  });
  const [draft, setDraft] = useState<ChannelVideoDraft | null>(restored.draft);
  const initial =
    restored.draft?.stage === "submit" ? restored.draft.input : restored.draft?.metadata;
  const [title, setTitle] = useState(initial?.title ?? ""),
    [description, setDescription] = useState(initial?.description ?? "");
  const [expanded, setExpanded] = useState(!!restored.draft || restored.error !== null);
  const [file, setFile] = useState<MobileUploadFile | null>(null);
  const [error, setError] = useState<string | null>(restored.error);
  const [busy, setBusy] = useState(false),
    [success, setSuccess] = useState(false);
  const controller = useRef<AbortController | null>(null),
    live = useRef(false),
    foreground = useRef(false);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      controller.current?.abort();
    };
  }, []);
  useLayoutEffect(() => {
    foreground.current = active;
    return () => {
      foreground.current = false;
      controller.current?.abort();
    };
  }, [active]);
  const current = () => live.current && getAuthGeneration() === scope.generation;
  const reason = (cause: unknown) =>
    cause instanceof Error && !(cause instanceof ZodError) && cause.message
      ? cause.message
      : t("channelSubmissions.failed");
  async function pick() {
    if (controller.current || draft || !foreground.current) return;
    const token = new AbortController();
    controller.current = token;
    setBusy(true);
    setError(null);
    try {
      const result = await getDocumentAsync({
        type: ["video/mp4", "video/webm", "video/quicktime"],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (!current() || token.signal.aborted || result.canceled) return;
      const asset = result.assets[0];
      setFile({ uri: asset.uri, name: asset.name, type: asset.mimeType ?? "", size: asset.size });
    } catch (cause) {
      if (current()) setError(reason(cause));
    } finally {
      if (controller.current === token) controller.current = null;
      if (current()) setBusy(false);
    }
  }
  async function send() {
    if (controller.current || !foreground.current || !current() || restored.error !== null) return;
    const token = new AbortController();
    controller.current = token;
    setBusy(true);
    setError(null);
    setSuccess(false);
    const assertCurrent = () => {
      token.signal.throwIfAborted();
      if (!current()) throw Error("Channel session changed.");
    };
    const persist = (value: ChannelVideoDraft) => {
      assertCurrent();
      storage.save(value);
      setDraft(value);
    };
    try {
      const settings = await fetchChannelSubmissions(scope, null, token.signal);
      assertCurrent();
      if (!settings.community || !settings.open) throw Error(t("channelSubmissions.closed"));
      let operation = draft;
      if (!operation) {
        if (!file) return;
        const metadata = channelVideoInput.omit({ assetId: true }).parse({ title, description });
        const uploaded = await uploadChannelVideo(file, scope, token.signal, (confirmation) => {
          // Validate and save before the confirmation request is dispatched.
          persist({
            stage: "confirm",
            metadata,
            confirmation: {
              storageKey: confirmation.storageKey,
              kind: "episode_video",
              contentType: confirmation.contentType as
                | "video/mp4"
                | "video/webm"
                | "video/quicktime",
            },
          });
        });
        assertCurrent();
        operation = { stage: "submit", input: { ...metadata, assetId: uploaded.mediaAssetId } };
        persist(operation);
      } else if (operation.stage === "confirm") {
        const uploaded = await confirmMobileMediaUpload(operation.confirmation, token.signal);
        assertCurrent();
        operation = {
          stage: "submit",
          input: { ...operation.metadata, assetId: uploaded.mediaAssetId },
        };
        persist(operation);
      }
      assertCurrent();
      await submitChannelVideo(scope, operation.input);
      // A known receipt may clear recovery even if the app backgrounded during POST.
      if (!current()) return;
      storage.clear();
      setDraft(null);
      setFile(null);
      setTitle("");
      setDescription("");
      setSuccess(true);
      setExpanded(false);
      onSubmitted();
    } catch (cause) {
      if (current()) setError(reason(cause));
    } finally {
      if (controller.current === token) controller.current = null;
      if (current()) setBusy(false);
    }
  }
  if (!active) return null;
  return (
    <View style={{ gap: 8 }}>
      <Action
        label={t(expanded ? "common.cancel" : "channelVideos.submit")}
        disabled={busy}
        onPress={() => {
          setExpanded(!expanded);
          setSuccess(false);
        }}
      />
      {success && <ThemedText type="small">{t("channelVideos.sent")}</ThemedText>}
      {expanded && (
        <>
          {error && (
            <ThemedText type="small" accessibilityRole="alert">
              {error}
            </ThemedText>
          )}
          {draft && <ThemedText type="small">{t("channelVideos.recover")}</ThemedText>}
          <TextInput
            accessibilityLabel={t("channelVideos.videoTitle")}
            placeholder={t("channelVideos.videoTitle")}
            placeholderTextColor={theme.textSecondary}
            value={title}
            onChangeText={setTitle}
            editable={!busy && !draft}
            maxLength={200}
            style={{
              color: theme.text,
              padding: 10,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 8,
            }}
          />
          <TextInput
            accessibilityLabel={t("channelVideos.description")}
            placeholder={t("channelVideos.description")}
            placeholderTextColor={theme.textSecondary}
            value={description}
            onChangeText={setDescription}
            editable={!busy && !draft}
            maxLength={5000}
            multiline
            style={{
              color: theme.text,
              padding: 10,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 8,
            }}
          />
          {!draft && (
            <Action
              label={file?.name ?? t("channelVideos.choose")}
              disabled={busy}
              onPress={() => void pick()}
            />
          )}
          {busy && <ActivityIndicator accessibilityLabel={t("channelSubmissions.loading")} />}
          <Action
            label={t(draft ? "channelSubmissions.retry" : "channelSubmissions.send")}
            disabled={busy || restored.error !== null || (!draft && (!file || !title.trim()))}
            onPress={() => void send()}
          />
        </>
      )}
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
        backgroundColor: theme.backgroundElement,
        borderRadius: 8,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}
