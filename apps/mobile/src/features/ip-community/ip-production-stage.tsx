import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { z } from "zod";
import { useAuth } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useLocale, useTranslations } from "@/i18n";
import { api } from "@/lib/api-client";

const response = z.object({
  stage: z.enum(["testing", "story_testing", "production", "released"]),
});
type Stage = z.infer<typeof response>["stage"];

export function IpProductionStage({ ipId }: { ipId: string }) {
  const { generation } = useAuth();
  const locale = useLocale();
  const active = useScreenActive();
  if (!active) return null;
  return (
    <StageLine
      key={JSON.stringify([ipId, generation, locale])}
      ipId={ipId}
      generation={generation}
    />
  );
}

function StageLine({ ipId, generation }: { ipId: string; generation: number }) {
  const t = useTranslations();
  const [result, setResult] = useState<{ stage?: Stage; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && getAuthGeneration() === generation;
    void api
      .get(`/ip-commerce/ips/${encodeURIComponent(ipId)}/production-stage`, {
        service: "aurora",
        signal: controller.signal,
        retry: false,
      })
      .then((value) => {
        if (!current()) return;
        const parsed = response.safeParse(value);
        setResult(parsed.success ? { stage: parsed.data.stage } : { error: "" });
      })
      .catch((error: unknown) => {
        if (current()) setResult({ error: error instanceof Error ? error.message : "" });
      });
    return () => controller.abort();
  }, [ipId, generation, attempt]);

  return (
    <View style={{ gap: 4 }}>
      {result?.stage ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t("ipProductionStage.title")}: {t(`ipProductionStage.${result.stage}`)}
        </ThemedText>
      ) : result === null ? (
        <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
          {t("ipProductionStage.loading")}
        </ThemedText>
      ) : (
        <View style={{ gap: 4 }}>
          <ThemedText type="small" themeColor="textSecondary" accessibilityRole="alert">
            {result.error || t("ipProductionStage.error")}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}
            onPress={() => {
              if (getAuthGeneration() !== generation) return;
              setResult(null);
              setAttempt((value) => value + 1);
            }}
          >
            <ThemedText type="smallBold">{t("ipProductionStage.retry")}</ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}
