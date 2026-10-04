import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { uuid } from "expo-modules-core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { getAuthGeneration } from "@/auth/auth-store";
import {
  storyCover,
  usableStoryCover,
  type StoryCoverProject,
  type StoryCoverCommand,
} from "../api/story-cover-api";
import { fetchTimelineCandidates, type TimelineCandidate } from "../api/story-timeline-media";
import { timelineUpload } from "../api/story-timeline-upload";
import type { StoryRepairScope } from "../api/story-draft-repair-api";
export function StoryCoverEditor({
  scope,
  userId,
  onClose,
  onSaved,
}: {
  scope: StoryRepairScope;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const client = useMemo(() => storyCover(scope, userId), [scope, userId]);
  const uploads = useMemo(() => timelineUpload(scope, userId), [scope, userId]);
  const life = useRef<AbortController | null>(null),
    lock = useRef(false);
  const [project, setProject] = useState<StoryCoverProject>();
  const [pending, setPending] = useState<StoryCoverCommand | null>(null);
  const [candidates, setCandidates] = useState<TimelineCandidate[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const [uploadPending, setUploadPending] = useState(false);
  const notifySaved = useEffectEvent(onSaved);
  const current = () =>
    !!life.current && !life.current.signal.aborted && getAuthGeneration() === scope.generation;
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    const alive = () => !controller.signal.aborted && getAuthGeneration() === scope.generation;
    void (async () => {
      try {
        const result = await client.load(controller.signal);
        if (!alive()) return;
        if (result.applied) notifySaved();
        setProject(result.project);
        setPending(result.pending ?? null);
        setUploadPending(!!uploads.read());
        const media = await fetchTimelineCandidates(scope, controller.signal);
        if (!alive()) return;
        setCandidates(media.filter((c) => usableStoryCover(c.asset)));
        setError(undefined);
      } catch (e) {
        if (alive()) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive()) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [client, uploads, scope, revision]);
  const reload = () => {
    setLoading(true);
    setProject(undefined);
    setCandidates([]);
    setRevision((v) => v + 1);
  };
  const editable = project?.status === "active" && project.capabilities.includes("story.edit");
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
  const save = (assetId: string | null) => {
    if (!project || !editable || pending) return;
    void run(async (signal) => {
      const updated = await client.save(
        {
          clientKey: uuid.v4(),
          expectedProjectVersion: project.projectVersion,
          coverAssetId: assetId,
        },
        signal
      );
      if (current()) {
        setProject(updated);
        onSaved();
      }
    });
  };
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
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <ThemedText type="smallBold">{t("storyCover.title")}</ThemedText>
          {<CoverAction label={t("agent.close")} onPress={onClose} disabled={false} />}
          {loading || busy ? <ActivityIndicator /> : null}
          {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
          {<CoverAction label={t("common.retry")} onPress={reload} disabled={loading || busy} />}
          {project ? (
            <>
              <ThemedText type="small">{t("storyCover.help")}</ThemedText>
              {usableStoryCover(project.cover) && project.cover?.previewUrl ? (
                <Image
                  source={{ uri: project.cover.previewUrl }}
                  accessibilityLabel={t("storyCover.title")}
                  contentFit="contain"
                  style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 8 }}
                />
              ) : (
                <ThemedText type="small">
                  {t(project.cover ? "storyCover.unavailable" : "storyCover.empty")}
                </ThemedText>
              )}
              {!editable ? <ThemedText>{t("storyRepair.readOnly")}</ThemedText> : null}
              {pending ? (
                <>
                  <ThemedText accessibilityRole="alert">{t("storyCover.pending")}</ThemedText>
                  {
                    <CoverAction
                      label={t("storyCover.retrySave")}
                      onPress={() =>
                        void run(async (signal) => {
                          const result = await client.save(pending, signal);
                          if (current()) {
                            setProject(result);
                            onSaved();
                          }
                        })
                      }
                      disabled={busy || !editable}
                    />
                  }
                  {
                    <CoverAction
                      label={t("storyCover.discard")}
                      onPress={() =>
                        Alert.alert(t("storyCover.discard"), t("storyCover.discardHelp"), [
                          { text: t("common.cancel"), style: "cancel" },
                          {
                            text: t("storyCover.discard"),
                            style: "destructive",
                            onPress: () => {
                              if (!current() || lock.current) return;
                              try {
                                client.discard(pending.clientKey);
                                setPending(null);
                                reload();
                              } catch (e) {
                                setError(String(e));
                              }
                            },
                          },
                        ])
                      }
                      disabled={busy}
                    />
                  }
                </>
              ) : null}
              {
                <CoverAction
                  label={t("storyCover.upload")}
                  onPress={() =>
                    void run(async (signal) => {
                      if (!editable || pending) return;
                      const candidate = uploadPending
                        ? await uploads.resume(signal)
                        : await uploads.pick(signal, true);
                      if (candidate && current()) {
                        if (!usableStoryCover(candidate.asset))
                          throw Error("Select a ready, unblocked image.");
                        setCandidates((rows) => [
                          candidate,
                          ...rows.filter((row) => row.asset.id !== candidate.asset.id),
                        ]);
                        const updated = await client.save(
                          {
                            clientKey: uuid.v4(),
                            expectedProjectVersion: project.projectVersion,
                            coverAssetId: candidate.asset.id,
                          },
                          signal
                        );
                        if (current()) {
                          setProject(updated);
                          onSaved();
                        }
                      }
                    })
                  }
                  disabled={busy || !editable || !!pending}
                />
              }
              {uploadPending ? (
                <ThemedText type="small">{t("storyCover.uploadPending")}</ThemedText>
              ) : null}
              {project.cover ? (
                <CoverAction
                  label={t("storyCover.remove")}
                  onPress={() =>
                    Alert.alert(t("storyCover.remove"), t("storyCover.removeHelp"), [
                      { text: t("common.cancel"), style: "cancel" },
                      {
                        text: t("storyCover.remove"),
                        style: "destructive",
                        onPress: () => save(null),
                      },
                    ])
                  }
                  disabled={busy || !editable || !!pending}
                />
              ) : null}
              <ThemedText type="smallBold">{t("storyCover.choose")}</ThemedText>
              {!candidates.length ? (
                <ThemedText type="small">{t("storyCover.noImages")}</ThemedText>
              ) : null}
              {candidates.map((candidate, index) => (
                <View key={candidate.asset.id} style={{ gap: 6 }}>
                  {candidate.asset.previewUrl ? (
                    <Image
                      source={{ uri: candidate.asset.previewUrl }}
                      contentFit="contain"
                      style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 8 }}
                    />
                  ) : null}
                  {
                    <CoverAction
                      label={t("storyCover.select").replace("{number}", String(index + 1))}
                      onPress={() => save(candidate.asset.id)}
                      disabled={
                        busy || !editable || !!pending || project.cover?.id === candidate.asset.id
                      }
                    />
                  }
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function CoverAction({
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
      style={{ minHeight: 44, justifyContent: "center", opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}
