import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { loadStoryCrewCandidates } from "../api/story-crew-candidates";
import type { CandidateScope } from "../api/story-candidates-api";

export function CrewCandidateList({
  scope,
  savedIds,
  filter,
  disabled,
  add,
  selectionLabel,
}: {
  scope: CandidateScope;
  savedIds: string[];
  filter: "all" | "visual" | "image" | "video" | "audio";
  disabled: boolean;
  add: (id: string) => void;
  selectionLabel?: string;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [result, setResult] = useState<Awaited<ReturnType<typeof loadStoryCrewCandidates>>>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const { projectId, generation } = scope;
  useEffect(() => {
    const controller = new AbortController();
    void loadStoryCrewCandidates({ projectId, generation }, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => controller.abort();
  }, [projectId, generation, revision]);
  const items =
    result?.items.filter(
      (item) =>
        filter === "all" ||
        (filter === "visual"
          ? ["image", "video"].includes(item.media?.kind ?? "")
          : item.media?.kind === filter)
    ) ?? [];
  return (
    <View style={{ gap: 8 }}>
      {!result && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {result && (
        <ThemedText type="smallBold">{result.crew?.name ?? t("storyCandidates.noCrew")}</ThemedText>
      )}
      {result?.crew && !items.length && (
        <ThemedText type="small">{t("storyCandidates.crewEmpty")}</ThemedText>
      )}
      {items.map((item) => (
        <View
          key={item.id}
          style={{ padding: 12, borderRadius: 8, backgroundColor: theme.backgroundElement }}
        >
          <ThemedText type="smallBold">{item.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {item.media!.contentType}
          </ThemedText>
          {savedIds.includes(item.media!.id) ? (
            <ThemedText type="small">{t("storyCandidates.saved")}</ThemedText>
          ) : (
            <Action
              label={selectionLabel ?? t("storyCandidates.save")}
              disabled={disabled}
              run={() => add(item.media!.id)}
            />
          )}
        </View>
      ))}
      {(result || error) && (
        <Action
          label={t(error ? "common.retry" : "storyCandidates.refresh")}
          disabled={disabled}
          run={() => {
            setResult(undefined);
            setError(undefined);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </View>
  );
}

function Action({
  label,
  run,
  disabled = false,
}: {
  label: string;
  run: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={run}
      style={{ paddingVertical: 12, opacity: disabled ? 0.45 : 1 }}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}
