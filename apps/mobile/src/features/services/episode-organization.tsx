import { useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { fetchEpisodeCreateAccess } from "./episode-create-api";
import { fetchCrewEpisodes, type CrewEpisode } from "./episode-management-api";
import { moveEpisode, removeEpisode } from "./episode-organization-api";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function EpisodeOrganization(props: Props) {
  const active = useScreenActive();
  const focused = useIsFocused();
  if (!focused || props.generation !== getAuthGeneration()) return null;
  return (
    <View style={{ flex: 1, display: active ? "flex" : "none" }}>
      <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />
    </View>
  );
}
function Session(props: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
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
  if (visible?.rows && visible.allowed)
    return (
      <Editor
        key={revision}
        {...props}
        rows={visible.rows}
        refresh={() => setRevision((n) => n + 1)}
      />
    );
  return (
    <View style={{ padding: 16, gap: 12 }}>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      {visible?.rows && !visible.allowed && (
        <ThemedText>{t("episodeOrganization.denied")}</ThemedText>
      )}
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => setRevision((n) => n + 1)}
      >
        <ThemedText>{t("thread.refresh")}</ThemedText>
      </Pressable>
      <Pressable accessibilityRole="button" style={{ padding: 12 }} onPress={props.onClose}>
        <ThemedText>{t("crewTasks.back")}</ThemedText>
      </Pressable>
    </View>
  );
}
function Editor(props: Props & { rows: CrewEpisode[]; refresh: () => void }) {
  const active = useScreenActive();
  const t = useTranslations(),
    op = useAuthFormOperation(props.crewId, true);
  const [confirmation, setConfirmation] = useState<CrewEpisode>(),
    [attempted, setAttempted] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState<string>();
  const sent = useRef(false);
  const locked = attempted || op.busy;
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
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("episodeOrganization.title")}</ThemedText>
      <ThemedText>{t("episodeOrganization.help")}</ThemedText>
      {props.rows.map((row, index) => (
        <View key={row.id} style={{ gap: 8, paddingVertical: 12 }}>
          <ThemedText>
            {row.number} · {row.title}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            disabled={locked || !!confirmation || index === 0}
            style={{ padding: 12 }}
            onPress={() => perform(() => moveEpisode(props.rows, row.id, "up", props.generation))}
          >
            <ThemedText>{t("episodeOrganization.up")}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={locked || !!confirmation || index === props.rows.length - 1}
            style={{ padding: 12 }}
            onPress={() => perform(() => moveEpisode(props.rows, row.id, "down", props.generation))}
          >
            <ThemedText>{t("episodeOrganization.down")}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={locked || !!confirmation || row.taskProgress.total > 0}
            style={{ padding: 12 }}
            onPress={() => setConfirmation(row)}
          >
            <ThemedText>{t("episodeOrganization.remove")}</ThemedText>
          </Pressable>
        </View>
      ))}
      {confirmation && (
        <View style={{ gap: 12 }}>
          <ThemedText>
            {t("episodeOrganization.confirmHelp")} · {confirmation.number} · {confirmation.title}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            style={{ padding: 12 }}
            onPress={() => perform(() => removeEpisode(confirmation, props.generation))}
          >
            <ThemedText>{t("episodeOrganization.confirm")}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            style={{ padding: 12 }}
            onPress={() => setConfirmation(undefined)}
          >
            <ThemedText>{t("episodeOrganization.cancel")}</ThemedText>
          </Pressable>
        </View>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved && <ThemedText>{t("episodeOrganization.saved")}</ThemedText>}
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
    </ScrollView>
  );
}
