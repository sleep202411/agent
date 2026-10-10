import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { getAuthGeneration } from "@/auth/auth-store";
import type { PlatformCanvasScope } from "../api/platform-canvas-document";
import { canvasStoryboardExport, type CanvasExportJob } from "../api/canvas-storyboard-export";
export function CanvasStoryboardExport({
  scope,
  userId,
  sequence,
  disabled,
}: {
  scope: PlatformCanvasScope;
  userId: string;
  sequence: number;
  disabled: boolean;
}) {
  const t = useTranslations();
  const [format, setFormat] = useState("1280x720");
  const client = useMemo(() => canvasStoryboardExport(scope, userId), [scope, userId]);
  const [jobs, setJobs] = useState<CanvasExportJob[]>([]),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false);
  const life = useRef<AbortController | null>(null),
    operation = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await client.list(controller.signal);
        if (!controller.signal.aborted) setJobs(value);
      } catch (e) {
        if (!controller.signal.aborted) setError(String(e));
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client]);
  async function act(run: (signal: AbortSignal) => Promise<unknown>) {
    const controller = life.current;
    if (!controller || controller.signal.aborted || operation.current) return;
    operation.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await run(controller.signal);
      const value = await client.list(controller.signal);
      if (!controller.signal.aborted) setJobs(value);
    } catch (e) {
      if (!controller.signal.aborted) setError(String(e));
    } finally {
      operation.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {["1280x720", "1920x1080", "720x1280", "1080x1920"].map((value) => (
          <Pressable
            key={value}
            disabled={busy}
            accessibilityState={{ selected: format === value }}
            onPress={() => setFormat(value)}
            style={{ padding: 8 }}
          >
            <ThemedText>
              {format === value ? "✓ " : ""}
              {value.replace("x", " × ")}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      <Pressable
        disabled={busy || disabled}
        onPress={() => void act((signal) => client.create(uuid.v4(), sequence, signal, format))}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("storyboard.export")}</ThemedText>
      </Pressable>
      <ThemedText type="small">{t("storyboard.exportHelp")}</ThemedText>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {jobs.map((job) => (
        <View key={job.id} style={{ gap: 6 }}>
          <ThemedText type="small">{t(`storyboard.${job.status}`)}</ThemedText>
          {job.error && <ThemedText>{job.error}</ThemedText>}
          {job.status === "completed" && (
            <Pressable
              disabled={busy}
              onPress={() =>
                void act(async (signal) => {
                  const url = await client.download(job.id, signal);
                  if (!signal.aborted && scope.generation === getAuthGeneration())
                    await Linking.openURL(url);
                })
              }
            >
              <ThemedText>{t("storyboard.download")}</ThemedText>
            </Pressable>
          )}
          {["queued", "running"].includes(job.status) && (
            <Pressable
              disabled={busy}
              onPress={() => void act((signal) => client.cancel(job.id, signal))}
            >
              <ThemedText>{t("common.cancel")}</ThemedText>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}
