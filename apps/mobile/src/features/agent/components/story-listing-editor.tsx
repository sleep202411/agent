import { StoryCoverEditor } from "./story-cover-editor";
import { ConversationVideo } from "@/features/services/conversation-video";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { uuid } from "expo-modules-core";
import { z } from "zod";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { api } from "@/lib/api-client";
import {
  storyListing,
  storyStoreListingSchema,
  type StoryListingProject,
  type StoryListingCommand,
  type StoryStoreListing,
} from "../api/story-listing-api";
import { candidateSchema, type TimelineCandidate } from "../api/story-timeline-media";
import { timelineUpload } from "../api/story-timeline-upload";
import type { StoryRepairScope } from "../api/story-draft-repair-api";
const draftSchema = z.object({
  version: z.number().int().nonnegative(),
  value: storyStoreListingSchema.extend({
    description: z.string().max(13000),
    developer: z.string().max(60),
  }),
});
const empty: StoryStoreListing = {
  description: "",
  developer: "",
  tags: [],
  trailerAssetId: null,
  screenshotAssetIds: [],
};
export function StoryListingEditor({
  scope,
  userId,
  onClose,
  onSaved,
}: {
  scope: StoryRepairScope;
  userId: string;
  onClose(): void;
  onSaved(): void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const client = useMemo(() => storyListing(scope, userId), [scope, userId]);
  const storage = useMemo(
    () => durableRecord("story-listing-draft", userId, scope.projectId),
    [scope.projectId, userId]
  );
  const uploads = useMemo(() => timelineUpload(scope, userId), [scope, userId]);
  const life = useRef<AbortController | null>(null),
    lock = useRef(false);
  const [project, setProject] = useState<StoryListingProject>();
  const [draft, setDraft] = useState<z.infer<typeof draftSchema>>();
  const [pending, setPending] = useState<StoryListingCommand | null>(null);
  const [media, setMedia] = useState<TimelineCandidate[]>([]);
  const [error, setError] = useState<string>(),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [coverOpen, setCoverOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string>();
  const [tag, setTag] = useState(""),
    [uploadPending, setUploadPending] = useState(false);
  const current = () =>
    !!life.current && !life.current.signal.aborted && getAuthGeneration() === scope.generation;
  useEffect(() => {
    const c = new AbortController();
    life.current = c;
    const alive = () => !c.signal.aborted && getAuthGeneration() === scope.generation;
    void (async () => {
      try {
        const result = await client.load(c.signal);
        if (!alive()) return;
        const raw = storage.read(),
          local = raw ? draftSchema.nullable().parse(JSON.parse(raw)) : null;
        let next = local;
        if (
          local &&
          result.project.projectVersion > local.version &&
          JSON.stringify(storyStoreListingSchema.parse(local.value)) ===
            JSON.stringify(result.project.storeListing)
        ) {
          storage.write("null");
          next = null;
        }
        setProject(result.project);
        setPending(result.pending ?? null);
        setDraft(
          (result.pending
            ? {
                version: result.pending.expectedProjectVersion,
                value: result.pending.storeListing ?? empty,
              }
            : next) ?? {
            version: result.project.projectVersion,
            value: result.project.storeListing ?? empty,
          }
        );
        setUploadPending(!!uploads.read());
        const candidates = z.array(candidateSchema).parse(
          await api.get("/story-projects/" + scope.projectId + "/candidate-assets", {
            service: "aurora",
            signal: c.signal,
            retry: false,
          })
        );
        if (!alive()) return;
        if (new Set(candidates.map((v) => v.asset.id)).size !== candidates.length)
          throw Error("Duplicate project media returned.");
        setMedia(
          candidates.filter(
            (v) =>
              ["image", "video"].includes(v.asset.kind) &&
              v.asset.status === "ready" &&
              v.asset.moderationStatus !== "blocked"
          )
        );
        setError(undefined);
      } catch (e) {
        if (alive()) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive()) setLoading(false);
      }
    })();
    return () => c.abort();
  }, [client, storage, uploads, scope, revision]);
  const editable = project?.status === "active" && project.capabilities.includes("story.edit");
  const disabled = busy || loading || !!pending || !editable;
  const latest = useRef({ project, draft, pending, loading, busy, editable });
  useLayoutEffect(() => {
    latest.current = { project, draft, pending, loading, busy, editable };
  }, [project, draft, pending, loading, busy, editable]);
  const confirmCurrent = () =>
    current() &&
    !lock.current &&
    !latest.current.loading &&
    !latest.current.busy &&
    latest.current.editable &&
    latest.current.project === project &&
    latest.current.draft === draft &&
    latest.current.pending === pending;
  const clearListing = () =>
    Alert.alert(t("storyListing.clear"), t("storyListing.clearHelp"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("storyListing.clear"),
        style: "destructive",
        onPress: () => {
          if (!confirmCurrent() || !project || pending) return;
          save({
            clientKey: uuid.v4(),
            expectedProjectVersion: project.projectVersion,
            storeListing: null,
          });
        },
      },
    ]);
  const keepDraft = () =>
    Alert.alert(t("storyListing.keepDraft"), t("storyListing.keepDraftHelp"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("storyListing.keepDraft"),
        onPress: () => {
          if (!confirmCurrent() || !project || !draft) return;
          try {
            const next = { ...draft, version: project.projectVersion };
            storage.write(JSON.stringify(next));
            if (pending) client.discard(pending.clientKey);
            setPending(null);
            setDraft(next);
            setReviewOpen(false);
            setError(undefined);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);
  const edit = (value: StoryStoreListing) => {
    if (!current() || lock.current || disabled || !draft) return;
    try {
      const next = { ...draft, value };
      storyStoreListingSchema.parse(value);
      storage.write(JSON.stringify(next));
      setDraft(next);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const reload = () => {
    if (lock.current) return;
    setLoading(true);
    setProject(undefined);
    setMedia([]);
    setRevision((v) => v + 1);
  };
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (!current() || lock.current || loading) return;
    lock.current = true;
    setBusy(true);
    try {
      await work(life.current!.signal);
      if (current()) setError(undefined);
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (current()) {
        try {
          setPending(client.read() ?? null);
          setUploadPending(!!uploads.read());
        } catch (e) {
          setError(String(e));
        }
        setBusy(false);
      }
      lock.current = false;
    }
  };
  const save = (command: StoryListingCommand) =>
    void run(async (signal) => {
      const updated = await client.save(command, signal);
      if (!current()) return;
      storage.write("null");
      setProject(updated);
      setDraft({ version: updated.projectVersion, value: updated.storeListing ?? empty });
      onSaved();
    });
  const discard = () =>
    Alert.alert(t("storyListing.discard"), t("storyListing.discardHelp"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("storyListing.discard"),
        style: "destructive",
        onPress: () => {
          if (!current() || lock.current) return;
          try {
            storage.write("null");
            if (pending) client.discard(pending.clientKey);
            reload();
          } catch (e) {
            setError(String(e));
          }
        },
      },
    ]);
  const move = (index: number, direction: number) => {
    if (!draft) return;
    const ids = [...draft.value.screenshotAssetIds],
      other = index + direction;
    if (other < 0 || other >= ids.length) return;
    [ids[index], ids[other]] = [ids[other], ids[index]];
    edit({ ...draft.value, screenshotAssetIds: ids });
  };
  if (coverOpen)
    return (
      <StoryCoverEditor
        scope={scope}
        userId={userId}
        onSaved={onSaved}
        onClose={() => {
          setCoverOpen(false);
          reload();
        }}
      />
    );
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 12 }}
        >
          <ThemedText type="smallBold">{t("storyListing.title")}</ThemedText>
          <ListingAction label={t("agent.close")} onPress={onClose} />
          {(loading || busy) && <ActivityIndicator />}
          {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
          <ListingAction
            label={t("documentFeed.refresh")}
            onPress={reload}
            disabled={busy || loading}
          />
          {project && draft && (
            <>
              <ThemedText type="small">{t("storyListing.help")}</ThemedText>
              <ListingAction
                label={t("storyCover.title")}
                onPress={() => {
                  setPreviewId(undefined);
                  setCoverOpen(true);
                }}
                disabled={busy || loading}
              />
              <ListingAction
                label={t("storyListing.reviewServer")}
                onPress={() => setReviewOpen((value) => !value)}
                disabled={busy || loading}
              />
              {reviewOpen && (
                <View
                  style={{
                    gap: 8,
                    padding: 12,
                    borderRadius: 8,
                    backgroundColor: theme.backgroundElement,
                  }}
                >
                  <ThemedText type="smallBold">{t("storyListing.serverDetails")}</ThemedText>
                  <ThemedText type="small">
                    {t("storyListing.description")}: {project.storeListing?.description || "—"}
                  </ThemedText>
                  <ThemedText type="small">
                    {t("storyListing.developer")}: {project.storeListing?.developer || "—"}
                  </ThemedText>
                  <ThemedText type="small">
                    {t("storyListing.tags")}: {project.storeListing?.tags.join(", ") || "—"}
                  </ThemedText>
                  <ThemedText type="small">{t("storyListing.trailer")}</ThemedText>
                  {project.storeListing?.trailerAssetId ? (
                    media.find((v) => v.asset.id === project.storeListing?.trailerAssetId)?.asset
                      .previewUrl ? (
                      <ConversationVideo
                        url={
                          media.find((v) => v.asset.id === project.storeListing?.trailerAssetId)!
                            .asset.previewUrl!
                        }
                        onRetry={reload}
                      />
                    ) : (
                      <ThemedText type="small">{t("storyCanvas.media.unavailable")}</ThemedText>
                    )
                  ) : (
                    <ThemedText type="small">—</ThemedText>
                  )}
                  <ThemedText type="small">{t("storyListing.screenshots")}</ThemedText>
                  {(project.storeListing?.screenshotAssetIds ?? []).map((id) => {
                    const asset = media.find((v) => v.asset.id === id)?.asset;
                    return asset?.previewUrl ? (
                      <Image
                        key={id}
                        source={{ uri: asset.previewUrl }}
                        contentFit="contain"
                        style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 8 }}
                      />
                    ) : (
                      <ThemedText key={id} type="small">
                        {t("storyCanvas.media.unavailable")}
                      </ThemedText>
                    );
                  })}
                  {(draft.version !== project.projectVersion || pending) && (
                    <ListingAction
                      label={t("storyListing.keepDraft")}
                      onPress={keepDraft}
                      disabled={busy || loading || !editable}
                    />
                  )}
                </View>
              )}
              {!editable && <ThemedText type="small">{t("storyRepair.readOnly")}</ThemedText>}
              {draft.version !== project.projectVersion && !pending && (
                <ThemedText type="small">{t("storyListing.conflict")}</ThemedText>
              )}
              {pending && (
                <>
                  <ThemedText type="small">{t("storyListing.pending")}</ThemedText>
                  <ListingAction
                    label={t("storyCover.retrySave")}
                    onPress={() => save(pending)}
                    disabled={busy || loading || !editable}
                  />
                </>
              )}
              {(["description", "developer"] as const).map((key) => (
                <View key={key} style={{ gap: 4 }}>
                  <ThemedText type="small">{t(`storyListing.${key}`)}</ThemedText>
                  <TextInput
                    accessibilityLabel={t(`storyListing.${key}`)}
                    value={draft.value[key]}
                    editable={!disabled}
                    multiline={key === "description"}
                    maxLength={key === "description" ? 13000 : 60}
                    onChangeText={(value) => edit({ ...draft.value, [key]: value })}
                    style={{
                      color: theme.text,
                      backgroundColor: theme.backgroundElement,
                      padding: 10,
                      borderRadius: 8,
                      minHeight: key === "description" ? 120 : 44,
                    }}
                  />
                </View>
              ))}
              <ThemedText type="smallBold">{t("storyListing.tags")}</ThemedText>
              <TextInput
                accessibilityLabel={t("storyListing.addTag")}
                value={tag}
                onChangeText={setTag}
                editable={!disabled}
                maxLength={40}
                style={{
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  padding: 10,
                  borderRadius: 8,
                }}
              />
              <ListingAction
                label={t("storyListing.addTag")}
                disabled={
                  disabled ||
                  !tag.trim() ||
                  draft.value.tags.length >= 12 ||
                  draft.value.tags.includes(tag.trim())
                }
                onPress={() => {
                  edit({ ...draft.value, tags: [...draft.value.tags, tag.trim()] });
                  setTag("");
                }}
              />
              {draft.value.tags.map((value) => (
                <ListingAction
                  key={value}
                  label={t("storyListing.remove") + " " + value}
                  disabled={disabled}
                  onPress={() =>
                    edit({ ...draft.value, tags: draft.value.tags.filter((v) => v !== value) })
                  }
                />
              ))}
              <ThemedText type="smallBold">{t("storyListing.trailer")}</ThemedText>
              {draft.value.trailerAssetId && (
                <ListingAction
                  label={t("storyListing.removeTrailer")}
                  disabled={disabled}
                  onPress={() => edit({ ...draft.value, trailerAssetId: null })}
                />
              )}
              <ThemedText type="smallBold">{t("storyListing.screenshots")}</ThemedText>
              {draft.value.screenshotAssetIds.map((id, index) => {
                const asset = media.find((v) => v.asset.id === id)?.asset;
                return (
                  <View key={id} style={{ gap: 4 }}>
                    {asset?.previewUrl ? (
                      <Image
                        source={{ uri: asset.previewUrl }}
                        contentFit="contain"
                        style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 8 }}
                      />
                    ) : (
                      <ThemedText type="small">{t("storyCanvas.media.unavailable")}</ThemedText>
                    )}
                    <View style={{ flexDirection: "row", gap: 16 }}>
                      <ListingAction
                        label={t("storyListing.up")}
                        disabled={disabled || index === 0}
                        onPress={() => move(index, -1)}
                      />
                      <ListingAction
                        label={t("storyListing.down")}
                        disabled={disabled || index === draft.value.screenshotAssetIds.length - 1}
                        onPress={() => move(index, 1)}
                      />
                      <ListingAction
                        label={t("storyListing.remove")}
                        disabled={disabled}
                        onPress={() =>
                          edit({
                            ...draft.value,
                            screenshotAssetIds: draft.value.screenshotAssetIds.filter(
                              (v) => v !== id
                            ),
                          })
                        }
                      />
                    </View>
                  </View>
                );
              })}
              <ListingAction
                label={t(uploadPending ? "storyListing.resumeUpload" : "storyListing.upload")}
                disabled={disabled}
                onPress={() =>
                  void run(async (signal) => {
                    const candidate = uploadPending
                      ? await uploads.resume(signal)
                      : await uploads.pick(signal);
                    if (current() && candidate)
                      setMedia((values) => [
                        candidate,
                        ...values.filter((v) => v.asset.id !== candidate.asset.id),
                      ]);
                  })
                }
              />
              <ThemedText type="smallBold">{t("storyListing.chooseMedia")}</ThemedText>
              {media.map((v, index) => (
                <View key={v.asset.id} style={{ gap: 4 }}>
                  {v.asset.kind === "video" && v.asset.previewUrl && (
                    <>
                      <ListingAction
                        label={t("storyCandidates.preview")}
                        onPress={() =>
                          setPreviewId(previewId === v.asset.id ? undefined : v.asset.id)
                        }
                      />
                      {previewId === v.asset.id && (
                        <ConversationVideo
                          url={v.asset.previewUrl}
                          onRetry={() => setPreviewId(undefined)}
                        />
                      )}
                    </>
                  )}
                  {draft.value.trailerAssetId === v.asset.id && (
                    <ThemedText type="small">{t("storyListing.selectedTrailer")}</ThemedText>
                  )}

                  {v.asset.kind === "image" && v.asset.previewUrl && (
                    <Image
                      source={{ uri: v.asset.previewUrl }}
                      contentFit="contain"
                      style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 8 }}
                    />
                  )}
                  <ListingAction
                    label={
                      t(
                        v.asset.kind === "video"
                          ? "storyListing.selectTrailer"
                          : "storyListing.selectScreenshot"
                      ) +
                      " " +
                      (index + 1)
                    }
                    disabled={
                      disabled ||
                      (v.asset.kind === "video"
                        ? draft.value.trailerAssetId === v.asset.id
                        : draft.value.screenshotAssetIds.includes(v.asset.id) ||
                          draft.value.screenshotAssetIds.length >= 8)
                    }
                    onPress={() =>
                      edit({
                        ...draft.value,
                        ...(v.asset.kind === "video"
                          ? { trailerAssetId: v.asset.id }
                          : {
                              screenshotAssetIds: [...draft.value.screenshotAssetIds, v.asset.id],
                            }),
                      })
                    }
                  />
                </View>
              ))}
              <ListingAction
                label={t("storyListing.save")}
                disabled={disabled || draft.version !== project.projectVersion}
                onPress={() =>
                  save({
                    clientKey: uuid.v4(),
                    expectedProjectVersion: draft.version,
                    storeListing: draft.value,
                  })
                }
              />
              {project.storeListing && (
                <ListingAction
                  label={t("storyListing.clear")}
                  onPress={clearListing}
                  disabled={disabled}
                />
              )}
              <ListingAction
                label={t("storyListing.discard")}
                disabled={busy || loading}
                onPress={discard}
              />
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
function ListingAction({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: "center", opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
