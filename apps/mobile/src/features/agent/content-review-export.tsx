import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { getAuthGeneration } from "@/auth/auth-store";
import { exportContentReview } from "./api/content-review-api";
import { shareReviewReport } from "./share-review-report";
export function ContentReviewExport({
  workspaceId,
  generation,
  recordId,
  onAccessLost,
}: {
  workspaceId: string;
  generation: number;
  recordId: string;
  onAccessLost: (message: string) => void;
}) {
  const t = useTranslations();
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    []
  );
  async function exportReport() {
    if (active.current || generation !== getAuthGeneration()) return;
    const controller = new AbortController();
    active.current = controller;
    const current = () => !controller.signal.aborted && generation === getAuthGeneration();
    setBusy(true);
    setError(undefined);
    try {
      const report = await exportContentReview(
        workspaceId,
        generation,
        recordId,
        controller.signal
      );
      if (current()) await shareReviewReport(report.bytes, report.filename, current);
    } catch (cause) {
      if (current()) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const status =
          cause && typeof cause === "object" && "status" in cause ? cause.status : undefined;
        if (status === 401 || status === 403) onAccessLost(message);
        else setError(message);
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (current()) setBusy(false);
      }
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        style={{ padding: 12 }}
        onPress={() => void exportReport()}
      >
        <ThemedText>
          {t(busy ? "contentReviewHistory.exporting" : "contentReviewHistory.export")}
        </ThemedText>
      </Pressable>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    </View>
  );
}
