import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { assetGroups, fetchAssetTaskProgress } from "./asset-task-progress-api";
export function AssetTaskProgress(props: {
  crewId: string;
  generation: number;
  pending?: Partial<Record<(typeof assetGroups)[number], number>>;
  onClose: () => void;
}) {
  const active = useScreenActive();
  if (!active || props.generation !== getAuthGeneration()) return null;
  return <ProgressSession key={`${props.crewId}:${props.generation}`} {...props} />;
}
function ProgressSession({
  crewId,
  generation,
  onClose,
  pending,
}: {
  crewId: string;
  generation: number;
  pending?: Partial<Record<(typeof assetGroups)[number], number>>;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    revision: number;
    data?: Awaited<ReturnType<typeof fetchAssetTaskProgress>>;
    error?: string;
  }>();
  useEffect(() => {
    if (generation !== getAuthGeneration()) return;
    const controller = new AbortController();
    void fetchAssetTaskProgress(crewId, generation, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setSnapshot({ revision, data });
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setSnapshot({ revision, error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => controller.abort();
  }, [crewId, generation, revision]);
  if (generation !== getAuthGeneration()) return null;
  const visible = snapshot?.revision === revision ? snapshot : undefined;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <ThemedText>{t("assetTaskProgress.title")}</ThemedText>
      <ThemedText>{t("assetTaskProgress.help")}</ThemedText>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      {visible?.data &&
        assetGroups.map((key) => (
          <View
            key={key}
            style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}
          >
            <ThemedText>{t(`assetTaskProgress.${key}`)}</ThemedText>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <ThemedText>{`${visible.data![key].approved}/${visible.data![key].total}`}</ThemedText>
              {!!pending?.[key] && (
                <ThemedText type="small">
                  {t("assetTaskProgress.pending").replace("{count}", String(pending[key]))}
                </ThemedText>
              )}
            </View>
          </View>
        ))}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (generation === getAuthGeneration()) setRevision((value) => value + 1);
        }}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("thread.refresh")}</ThemedText>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onClose} style={{ padding: 12 }}>
        <ThemedText>{t("crewTasks.back")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
