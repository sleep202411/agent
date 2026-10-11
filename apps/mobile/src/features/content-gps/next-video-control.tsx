import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { toHref } from "@/lib/navigation";
import { gpsPlaybackPath } from "./playback-entry";
import { findNextVideo } from "./next-video";
export function NextVideoControl({ ipId }: { ipId: string }) {
  const { generation } = useAuth();
  const active = useScreenActive();
  return active ? (
    <Control key={`${generation}:${ipId}`} ipId={ipId} generation={generation} />
  ) : null;
}
function Control({ ipId, generation }: { ipId: string; generation: number }) {
  const active = useScreenActive(),
    t = useTranslations(),
    router = useRouter();
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [ended, setEnded] = useState(false);
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [active]
  );
  async function next() {
    if (!active || pending.current || generation !== getAuthGeneration()) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      const id = await findNextVideo(ipId, controller.signal);
      if (controller.signal.aborted || generation !== getAuthGeneration()) return;
      if (id) router.replace(toHref(gpsPlaybackPath(id)));
      else setEnded(true);
    } catch (cause) {
      if (!controller.signal.aborted && generation === getAuthGeneration())
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  if (!active) return null;
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 4 }}>
      {error && (
        <ThemedText type="small" accessibilityRole="alert">
          {error}
        </ThemedText>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy || ended}
        onPress={() => void next()}
        style={{ minHeight: 44, justifyContent: "center", opacity: busy || ended ? 0.5 : 1 }}
      >
        <ThemedText type="small">
          {t(
            ended
              ? "ipDetail.noNextVideo"
              : busy
                ? "ipDetail.loadingNextVideo"
                : "ipDetail.nextVideo"
          )}
        </ThemedText>
      </Pressable>
    </View>
  );
}
