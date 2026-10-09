import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { fetchEpisodeCreateAccess } from "./episode-create-api";
import { EpisodeOrganization } from "./episode-organization";
import { EpisodeDelivery } from "./episode-delivery";
import { EpisodeCreate } from "./episode-create";
import {
  fetchCrewEpisodes,
  episodeMetadataInput,
  updateEpisodeMetadata,
  type CrewEpisode,
} from "./episode-management-api";
import { parseScheduleDate, scheduleDateText } from "./task-schedule-api";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function EpisodeManagement(props: Props) {
  const active = useScreenActive();
  if (!active || props.generation !== getAuthGeneration()) return null;
  return <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />;
}
function Session(props: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0),
    [creating, setCreating] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [deliveryId, setDeliveryId] = useState<string>();
  const [selected, setSelected] = useState<CrewEpisode>();
  const [snapshot, setSnapshot] = useState<{
    revision: number;
    rows?: CrewEpisode[];
    allowed?: boolean;
    error?: string;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetchCrewEpisodes(props.crewId, controller.signal),
      fetchEpisodeCreateAccess(props.crewId, props.userId, controller.signal),
    ]).then(
      ([rows, allowed]) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setSnapshot({ revision, rows, allowed });
      },
      (cause) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setSnapshot({ revision, error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => controller.abort();
  }, [props.crewId, props.userId, props.generation, revision]);
  const visible = snapshot?.revision === revision ? snapshot : undefined;
  const reload = () => {
    setSelected(undefined);
    setDeliveryId(undefined);
    setCreating(false);
    setOrganizing(false);
    setRevision((n) => n + 1);
  };
  if (organizing) return <EpisodeOrganization {...props} onClose={reload} />;
  if (deliveryId) return <EpisodeDelivery {...props} episodeId={deliveryId} onClose={reload} />;
  if (creating) return <EpisodeCreate {...props} onClose={reload} />;
  if (selected)
    return (
      <Editor
        key={`${selected.id}:${selected.version}`}
        episode={selected}
        generation={props.generation}
        onClose={reload}
      />
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("episodeManagement.title")}</ThemedText>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      {visible?.rows?.length === 0 && <ThemedText>{t("episodeManagement.empty")}</ThemedText>}
      {visible?.allowed && (
        <Pressable
          accessibilityRole="button"
          style={{ padding: 12 }}
          onPress={() => {
            if (props.generation === getAuthGeneration()) setCreating(true);
          }}
        >
          <ThemedText>{t("episodeCreate.title")}</ThemedText>
        </Pressable>
      )}
      {visible?.allowed && (
        <Pressable
          accessibilityRole="button"
          style={{ padding: 12 }}
          onPress={() => {
            if (props.generation === getAuthGeneration()) setOrganizing(true);
          }}
        >
          <ThemedText>{t("episodeOrganization.title")}</ThemedText>
        </Pressable>
      )}
      {visible?.rows?.map((row) => (
        <View key={row.id} style={{ paddingVertical: 12, gap: 8 }}>
          <ThemedText>
            {row.number} · {row.title}
          </ThemedText>
          <ThemedText>{t(`episodeManagement.status_${row.status}`)}</ThemedText>
          <ThemedText>
            {t("episodeManagement.approved")} · {row.taskProgress.completed}/
            {row.taskProgress.total}
          </ThemedText>
          <ThemedText>
            {t("episodeManagement.pending")} · {row.taskProgress.pendingReview}
          </ThemedText>
          {!!row.synopsis && <ThemedText>{row.synopsis}</ThemedText>}
          {row.durationSeconds !== null && (
            <ThemedText>
              {t("episodeManagement.duration")} · {row.durationSeconds}
            </ThemedText>
          )}
          {row.plannedReleaseAt && (
            <ThemedText>
              {t("episodeManagement.release")} · {scheduleDateText(row.plannedReleaseAt)}
            </ThemedText>
          )}
          <Pressable
            accessibilityRole="button"
            style={{ padding: 12 }}
            onPress={() => {
              if (props.generation === getAuthGeneration()) setDeliveryId(row.id);
            }}
          >
            <ThemedText>{t("episodeDelivery.title")}</ThemedText>
          </Pressable>
          {visible.allowed && (
            <Pressable
              accessibilityRole="button"
              style={{ padding: 12 }}
              onPress={() => {
                if (props.generation === getAuthGeneration()) setSelected(row);
              }}
            >
              <ThemedText>{t("episodeManagement.edit")}</ThemedText>
            </Pressable>
          )}
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (props.generation === getAuthGeneration()) reload();
        }}
      >
        <ThemedText>{t("thread.refresh")}</ThemedText>
      </Pressable>
      <Pressable accessibilityRole="button" style={{ padding: 12 }} onPress={props.onClose}>
        <ThemedText>{t("crewTasks.back")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
function Editor({
  episode,
  generation,
  onClose,
}: {
  episode: CrewEpisode;
  generation: number;
  onClose: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(episode.id, true);
  const [title, setTitle] = useState(episode.title),
    [synopsis, setSynopsis] = useState(episode.synopsis),
    [number, setNumber] = useState(String(episode.number));
  const [duration, setDuration] = useState(
      episode.durationSeconds === null ? "" : String(episode.durationSeconds)
    ),
    [release, setRelease] = useState(scheduleDateText(episode.plannedReleaseAt));
  const [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>(),
    [saved, setSaved] = useState(false);
  const sent = useRef(false);
  const locked = attempted || op.busy;
  let input: ReturnType<typeof episodeMetadataInput.parse> | undefined;
  try {
    input = episodeMetadataInput.parse({
      expectedVersion: episode.version,
      title,
      synopsis,
      number: /^\d+$/.test(number) ? Number(number) : NaN,
      durationSeconds: duration.trim() ? (/^\d+$/.test(duration) ? Number(duration) : NaN) : null,
      plannedReleaseAt: parseScheduleDate(release, episode.plannedReleaseAt),
    });
  } catch {}
  const changed =
    input &&
    (input.title !== episode.title ||
      input.synopsis !== episode.synopsis ||
      input.number !== episode.number ||
      input.durationSeconds !== episode.durationSeconds ||
      input.plannedReleaseAt !== episode.plannedReleaseAt);
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText>{t("episodeManagement.edit")}</ThemedText>
      <ThemedText>{t("episodeManagement.metadataHelp")}</ThemedText>
      <ThemedText>{t("episodeCreate.name")}</ThemedText>
      <TextInput
        accessibilityLabel={t("episodeCreate.name")}
        value={title}
        onChangeText={setTitle}
        editable={!locked}
        maxLength={180}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("episodeCreate.number")}</ThemedText>
      <TextInput
        accessibilityLabel={t("episodeCreate.number")}
        value={number}
        onChangeText={setNumber}
        editable={!locked}
        maxLength={6}
        keyboardType="number-pad"
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("episodeCreate.synopsis")}</ThemedText>
      <TextInput
        accessibilityLabel={t("episodeCreate.synopsis")}
        value={synopsis}
        onChangeText={setSynopsis}
        editable={!locked}
        maxLength={20000}
        multiline
        style={{ color: theme.text, padding: 12, minHeight: 100 }}
      />
      <ThemedText>{t("episodeManagement.duration")}</ThemedText>
      <TextInput
        accessibilityLabel={t("episodeManagement.duration")}
        value={duration}
        onChangeText={setDuration}
        editable={!locked}
        maxLength={5}
        keyboardType="number-pad"
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("episodeManagement.release")}</ThemedText>
      <ThemedText>{t("episodeManagement.dateHelp")}</ThemedText>
      <TextInput
        accessibilityLabel={t("episodeManagement.release")}
        value={release}
        onChangeText={setRelease}
        editable={!locked}
        maxLength={16}
        placeholder="YYYY-MM-DD HH:mm"
        style={{ color: theme.text, padding: 12 }}
      />
      {error && (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <ThemedText>{t("episodeManagement.refreshHelp")}</ThemedText>
        </>
      )}
      {saved && <ThemedText>{t("episodeManagement.saved")}</ThemedText>}
      {!saved && (
        <Pressable
          accessibilityRole="button"
          style={{ padding: 12 }}
          disabled={locked || !input || !changed}
          onPress={() => {
            if (sent.current || generation !== getAuthGeneration() || !input) return;
            const snapshot = input;
            void op.run(
              () => {
                sent.current = true;
                setAttempted(true);
                return updateEpisodeMetadata(episode, snapshot, generation);
              },
              () => setSaved(true),
              (cause) => setError(cause instanceof Error ? cause.message : String(cause))
            );
          }}
        >
          <ThemedText>{t("episodeManagement.save")}</ThemedText>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        disabled={op.busy}
        onPress={onClose}
      >
        <ThemedText>{t("episodeManagement.back")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
