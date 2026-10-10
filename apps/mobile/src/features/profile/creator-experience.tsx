import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { SectionHeader } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";
import { getCreatorExperience, type ExperienceEntry } from "./experience-api";

export function CreatorExperience({ creatorId }: { creatorId: string }) {
  return <ExperienceSession key={creatorId} creatorId={creatorId} />;
}
function ExperienceSession({ creatorId }: { creatorId: string }) {
  const t = useTranslations();
  const focused = useIsFocused();
  const [rows, setRows] = useState<ExperienceEntry[]>();
  const [failed, setFailed] = useState<Error | boolean>(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!focused) return;
    const controller = new AbortController();
    void getCreatorExperience(creatorId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setRows(result);
          setFailed(false);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setFailed(cause instanceof Error ? cause : true);
      });
    return () => controller.abort();
  }, [creatorId, attempt, focused]);
  if (!failed && rows?.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader title={t("creatorDetail.experienceTitle")} />
      {failed ? (
        <View style={styles.entry}>
          <ThemedText accessibilityRole="alert">
            {failed instanceof Error ? failed.message : t("creatorDetail.experienceFailed")}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            <ThemedText>{t("profileEdit.retry")}</ThemedText>
          </Pressable>
        </View>
      ) : !rows ? (
        <ActivityIndicator />
      ) : (
        rows.map((row, index) => {
          const range = row.startTime
            ? `${row.startTime} — ${row.endTime || t("creatorDetail.present")}`
            : row.endTime;
          return (
            <View key={`${row.id ?? "entry"}-${index}`} style={styles.entry}>
              {!!row.title && <ThemedText type="smallBold">{row.title}</ThemedText>}
              {!!row.organization && <ThemedText type="small">{row.organization}</ThemedText>}
              {!!(range || row.location) && (
                <ThemedText type="small" themeColor="textSecondary">
                  {[range, row.location].filter(Boolean).join(" · ")}
                </ThemedText>
              )}
              {!!row.description && (
                <ThemedText type="small" themeColor="textSecondary">
                  {row.description}
                </ThemedText>
              )}
            </View>
          );
        })
      )}
    </View>
  );
}
const styles = StyleSheet.create({ section: { gap: Spacing.three }, entry: { gap: Spacing.one } });
