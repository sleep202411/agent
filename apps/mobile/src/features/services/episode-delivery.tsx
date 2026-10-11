import { useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { CrewAssetPicker } from "@/features/crew-assets/asset-picker";
import type { CrewAsset } from "@/features/crew-assets/api";
import { ConversationFile } from "./conversation-file";
import {
  fetchEpisodeDelivery,
  fetchEpisodeVideo,
  submitEpisodeDelivery,
  reviewEpisodeDelivery,
  type EpisodeDelivery as Delivery,
} from "./episode-delivery-api";
type Props = {
  crewId: string;
  episodeId: string;
  userId: string;
  generation: number;
  onClose: () => void;
};
export function EpisodeDelivery(props: Props) {
  const active = useScreenActive();
  const focused = useIsFocused();
  if (!focused || props.generation !== getAuthGeneration()) return null;
  return (
    <View style={{ flex: 1, display: active ? "flex" : "none" }}>
      <Session
        key={`${props.crewId}:${props.episodeId}:${props.userId}:${props.generation}`}
        {...props}
      />
    </View>
  );
}
function Session(props: Props) {
  const t = useTranslations(),
    theme = useTheme();
  const [revision, setRevision] = useState(0),
    [snapshot, setSnapshot] = useState<{
      revision: number;
      data?: Awaited<ReturnType<typeof fetchEpisodeDelivery>>;
      error?: string;
    }>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchEpisodeDelivery(props.crewId, props.episodeId, props.userId, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setSnapshot({ revision, data });
      },
      (cause) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setSnapshot({ revision, error: String(cause instanceof Error ? cause.message : cause) });
      }
    );
    return () => controller.abort();
  }, [props.crewId, props.episodeId, props.userId, props.generation, revision]);
  const visible = snapshot?.revision === revision ? snapshot : undefined;
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      {visible?.data && (
        <Workbench
          key={revision}
          {...props}
          data={visible.data}
          refresh={() => setRevision((n) => n + 1)}
        />
      )}
      {!visible?.data && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setRevision((n) => n + 1)}
          style={{ padding: 12 }}
        >
          <ThemedText>{t("thread.refresh")}</ThemedText>
        </Pressable>
      )}
      {!visible?.data && (
        <Pressable accessibilityRole="button" onPress={props.onClose} style={{ padding: 12 }}>
          <ThemedText>{t("crewTasks.back")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}
function Workbench(
  props: Props & { data: Awaited<ReturnType<typeof fetchEpisodeDelivery>>; refresh: () => void }
) {
  const active = useScreenActive();
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.episodeId, true);
  const [picker, setPicker] = useState(false),
    [asset, setAsset] = useState<CrewAsset>(),
    [note, setNote] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>(),
    [saved, setSaved] = useState(false);
  const sent = useRef(false),
    locked = attempted || op.busy;
  const { episode, canSubmit, canReview } = props.data;
  const pending = episode.deliveries.some((d) => d.status === "submitted");
  const perform = (request: () => Promise<unknown>) => {
    if (!active || sent.current || props.generation !== getAuthGeneration()) return;
    void op.run(
      () => {
        sent.current = true;
        setAttempted(true);
        return request();
      },
      () => setSaved(true),
      (cause) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText>
        {t("episodeDelivery.title")} · {episode.number} · {episode.title}
      </ThemedText>
      <ThemedText>{t("episodeDelivery.help")}</ThemedText>
      {episode.deliveries.length === 0 && <ThemedText>{t("episodeDelivery.empty")}</ThemedText>}
      {[...episode.deliveries]
        .sort((a, b) => b.versionNumber - a.versionNumber)
        .map((d) => (
          <View key={d.id} style={{ gap: 8, paddingVertical: 12 }}>
            <ThemedText>
              {t("episodeDelivery.version")} {d.versionNumber} · {t(`episodeDelivery.${d.status}`)}
            </ThemedText>
            <ThemedText>{new Date(d.createdAt).toLocaleString()}</ThemedText>
            <Video crewId={props.crewId} delivery={d} generation={props.generation} />
            {!!d.note && <ThemedText>{d.note}</ThemedText>}
            {!!d.reviewNote && (
              <ThemedText>
                {t("episodeDelivery.reviewNote")} · {d.reviewNote}
              </ThemedText>
            )}
            {d.reviewedAt && <ThemedText>{new Date(d.reviewedAt).toLocaleString()}</ThemedText>}
            {canReview && d.status === "submitted" && (
              <>
                <TextInput
                  accessibilityLabel={t("episodeDelivery.reviewNote")}
                  placeholder={t("episodeDelivery.reviewNote")}
                  value={reviewNotes[d.id] || ""}
                  onChangeText={(value) => setReviewNotes((old) => ({ ...old, [d.id]: value }))}
                  editable={!locked}
                  multiline
                  maxLength={10000}
                  style={{ color: theme.text, padding: 12 }}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={locked}
                  style={{ padding: 12 }}
                  onPress={() =>
                    perform(() =>
                      reviewEpisodeDelivery(
                        d,
                        "approve",
                        reviewNotes[d.id] || "",
                        props.userId,
                        props.generation
                      )
                    )
                  }
                >
                  <ThemedText>{t("episodeDelivery.approve")}</ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={locked || !reviewNotes[d.id]?.trim()}
                  style={{ padding: 12 }}
                  onPress={() =>
                    perform(() =>
                      reviewEpisodeDelivery(
                        d,
                        "reject",
                        reviewNotes[d.id] || "",
                        props.userId,
                        props.generation
                      )
                    )
                  }
                >
                  <ThemedText>{t("episodeDelivery.reject")}</ThemedText>
                </Pressable>
              </>
            )}
          </View>
        ))}
      {pending && <ThemedText>{t("episodeDelivery.pendingHelp")}</ThemedText>}
      {canSubmit && !pending && episode.status !== "cancelled" && (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            style={{ padding: 12 }}
            onPress={() => setPicker(true)}
          >
            <ThemedText>{t("episodeDelivery.select")}</ThemedText>
          </Pressable>
          {asset && <ThemedText>{asset.name}</ThemedText>}
          <TextInput
            accessibilityLabel={t("episodeDelivery.note")}
            placeholder={t("episodeDelivery.note")}
            value={note}
            onChangeText={setNote}
            editable={!locked}
            multiline
            maxLength={10000}
            style={{ color: theme.text, padding: 12 }}
          />
          <Pressable
            accessibilityRole="button"
            disabled={locked || !asset}
            style={{ padding: 12 }}
            onPress={() => {
              if (asset)
                perform(() =>
                  submitEpisodeDelivery(episode.id, asset.id, note, props.userId, props.generation)
                );
            }}
          >
            <ThemedText>{t("episodeDelivery.submit")}</ThemedText>
          </Pressable>
        </>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved && <ThemedText>{t("episodeDelivery.saved")}</ThemedText>}
      {attempted && <ThemedText>{t("episodeDelivery.refreshHelp")}</ThemedText>}
      <Pressable
        accessibilityRole="button"
        disabled={op.busy}
        style={{ padding: 12 }}
        onPress={props.refresh}
      >
        <ThemedText>{t("thread.refresh")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={op.busy}
        style={{ padding: 12 }}
        onPress={props.onClose}
      >
        <ThemedText>{t("crewTasks.back")}</ThemedText>
      </Pressable>
      {picker && (
        <Modal visible={active} onRequestClose={() => setPicker(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
            <CrewAssetPicker
              crewId={props.crewId}
              excludedIds={[]}
              remaining={1}
              onClose={() => setPicker(false)}
              onSelect={(assets) => {
                if (props.generation !== getAuthGeneration()) return;
                setPicker(false);
                const selected = assets[0];
                if (!selected || selected.kind !== "file" || selected.media?.kind !== "video") {
                  setError(t("episodeDelivery.videoRequired"));
                  return;
                }
                setAsset(selected);
                setError(undefined);
              }}
            />
          </SafeAreaView>
        </Modal>
      )}
    </ScrollView>
  );
}
function Video({
  crewId,
  delivery,
  generation,
}: {
  crewId: string;
  delivery: Delivery;
  generation: number;
}) {
  const [asset, setAsset] = useState<Awaited<ReturnType<typeof fetchEpisodeVideo>>>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchEpisodeVideo(crewId, delivery.assetNodeId, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted && generation === getAuthGeneration()) setAsset(value);
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [crewId, delivery.assetNodeId, generation]);
  return (
    <View>
      <ThemedText>{delivery.asset.name}</ThemedText>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {asset && (
        <ConversationFile
          mediaAssetId={asset.media.id}
          name={asset.name}
          mediaKind={asset.media.kind}
          contentType={asset.media.contentType}
        />
      )}
    </View>
  );
}
