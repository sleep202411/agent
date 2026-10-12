import { useIsFocused } from "expo-router";
import { ContentReviewCreate } from "./content-review-create";
import { ContentReviewExport } from "./content-review-export";
import { ContentReviewPlayback } from "./content-review-playback";
import { ContentReviewComment } from "./content-review-comment";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import { useLocale, useTranslations, type MessageKey } from "@/i18n";
import {
  getContentReview,
  listContentReviews,
  type ContentReviewDetail,
  type ContentReviewSummary,
} from "./api/content-review-api";
type Props = { workspaceId: string; generation: number; onClose: () => void };
export function ContentReviewHistory(props: Props) {
  const focused = useIsFocused();
  if (!focused || props.generation !== getAuthGeneration()) return null;
  return <History key={`${props.workspaceId}:${props.generation}`} {...props} />;
}
function History({ workspaceId, generation, onClose }: Props) {
  const theme = useTheme(),
    t = useTranslations(),
    locale = useLocale(),
    active = useScreenActive();
  const label = (key: string) => t(`contentReviewHistory.${key}` as MessageKey);
  const [recordId, setRecordId] = useState<string>(),
    [revision, setRevision] = useState(0);
  const key = JSON.stringify([recordId, revision]);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    items?: ContentReviewSummary[];
    record?: ContentReviewDetail;
    error?: string;
  }>();
  const [previousActive, setPreviousActive] = useState(active);
  if (previousActive !== active) {
    setPreviousActive(active);
    setSnapshot(undefined);
  }
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && generation === getAuthGeneration();
    if (recordId)
      void getContentReview(workspaceId, generation, recordId, controller.signal).then(
        (record) => {
          if (current()) setSnapshot({ key, record });
        },
        (error) => {
          if (current())
            setSnapshot({ key, error: error instanceof Error ? error.message : String(error) });
        }
      );
    else
      void listContentReviews(workspaceId, generation, controller.signal).then(
        (items) => {
          if (current()) setSnapshot({ key, items });
        },
        (error) => {
          if (current())
            setSnapshot({ key, error: error instanceof Error ? error.message : String(error) });
        }
      );
    return () => controller.abort();
  }, [workspaceId, generation, recordId, key, active]);
  const data = snapshot?.key === key ? snapshot : undefined;
  const record = data?.record;
  const box = { padding: 12, gap: 8, borderRadius: 8, backgroundColor: theme.backgroundElement };
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background, display: active ? "flex" : "none" }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => (recordId ? setRecordId(undefined) : onClose())}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("common.back")}</ThemedText>
      </Pressable>
      <ThemedText type="subtitle">{label("title")}</ThemedText>
      <Pressable
        accessibilityRole="button"
        onPress={() => setRevision((v) => v + 1)}
        style={{ padding: 12 }}
      >
        <ThemedText>{label("refresh")}</ThemedText>
      </Pressable>
      {!data && <ActivityIndicator />}
      {data?.error && <ThemedText accessibilityRole="alert">{data.error}</ThemedText>}
      {!recordId && (
        <ContentReviewCreate
          workspaceId={workspaceId}
          generation={generation}
          onOpen={setRecordId}
        />
      )}
      {data?.items && (
        <>
          <ThemedText type="small">{label("historyLimit")}</ThemedText>
          {!data.items.length && <ThemedText>{label("empty")}</ThemedText>}
          {data.items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              onPress={() => setRecordId(item.id)}
              style={box}
            >
              <ThemedText type="smallBold">{item.fileName}</ThemedText>
              <ThemedText type="small">
                {new Date(item.createdAt).toLocaleString(locale)}
              </ThemedText>
              <ThemedText type="small">
                {label("findings")}: {item.findingCount} · {label("credits")}: {item.creditsCharged}
              </ThemedText>
              <ThemedText type="small">
                {item.riskLevel ?? "—"} · {item.suggestion ?? "—"}
              </ThemedText>
            </Pressable>
          ))}
        </>
      )}
      {record && (
        <>
          <ThemedText type="smallBold">{record.fileName}</ThemedText>
          <ContentReviewExport
            key={key}
            workspaceId={workspaceId}
            generation={generation}
            recordId={record.id}
            onAccessLost={(error) => setSnapshot({ key, error })}
          />
          <ContentReviewPlayback
            key={`${key}:${record.mediaAssetId}`}
            workspaceId={workspaceId}
            generation={generation}
            record={record}
          />
          <View style={box}>
            <ThemedText>
              {label("duration")}: {record.durationSeconds}
            </ThemedText>
            <ThemedText>
              {label("credits")}: {record.creditsCharged}
            </ThemedText>
            <ThemedText>
              {label("risk")}: {record.riskLevel ?? "—"}
            </ThemedText>
            <ThemedText>
              {label("suggestion")}: {record.suggestion ?? "—"}
            </ThemedText>
            <ThemedText>
              {label("frameRisk")}: {record.overview.frameRiskLevel ?? "—"}
            </ThemedText>
            <ThemedText>
              {label("audioRisk")}: {record.overview.audioRiskLevel ?? "—"}
            </ThemedText>
          </View>
          <ThemedText type="smallBold">{label("findings")}</ThemedText>
          {!record.details.length && <ThemedText>{label("empty")}</ThemedText>}
          {record.details.map((finding, index) => (
            <View key={index} style={box}>
              <ThemedText type="smallBold">{finding.label ?? "—"}</ThemedText>
              <ThemedText>{finding.description ?? "—"}</ThemedText>
              <ThemedText type="small">
                {finding.source ?? "—"} · {finding.timeOffset ?? "—"}
              </ThemedText>
              {finding.confidence != null && (
                <ThemedText type="small">
                  {label("confidence")}: {finding.confidence}
                </ThemedText>
              )}
              {finding.audioText && <ThemedText>{finding.audioText}</ThemedText>}
            </View>
          ))}
          <ThemedText type="smallBold">{label("comments")}</ThemedText>
        </>
      )}
      {recordId && (
        <ContentReviewComment
          key={recordId}
          workspaceId={workspaceId}
          generation={generation}
          record={record}
          onAccessLost={(error) => setSnapshot({ key, error })}
          onSaved={() => setRevision((value) => value + 1)}
        />
      )}
      {record && (
        <>
          {!record.comments.length && <ThemedText>{label("empty")}</ThemedText>}
          {record.comments.map((comment) => (
            <View key={comment.id} style={box}>
              <ThemedText>{comment.body}</ThemedText>
              <ThemedText type="small">
                {comment.seconds}s · {comment.createdByUserId} ·{" "}
                {new Date(comment.createdAt).toLocaleString(locale)}
              </ThemedText>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}
