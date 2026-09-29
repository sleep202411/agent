import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { fetchCrewAssetAccess } from "@/features/crew-assets/api";
/** Resolve access at the time of opening; never retain signed URLs in chat state. */
function File({ mediaAssetId, name }: { mediaAssetId: string; name: string }) {
  const t = useTranslations();
  const request = useRef<AbortController | undefined>(undefined);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = undefined;
    },
    [mediaAssetId]
  );
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          if (request.current) return;
          const controller = new AbortController(),
            generation = getAuthGeneration();
          request.current = controller;
          setBusy(true);
          setError(undefined);
          void (async () => {
            try {
              const access = await fetchCrewAssetAccess(mediaAssetId, controller.signal);
              if (controller.signal.aborted || generation !== getAuthGeneration()) return;
              await Linking.openURL(access.url);
            } catch (cause) {
              if (!controller.signal.aborted && generation === getAuthGeneration())
                setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
              if (request.current === controller) {
                request.current = undefined;
                setBusy(false);
              }
            }
          })();
        }}
        style={{ padding: 12 }}
      >
        <ThemedText>
          {t("thread.openFile")}: {name}
        </ThemedText>
      </Pressable>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    </View>
  );
}

export function ConversationFile(props: { mediaAssetId: string; name: string }) {
  const active = useScreenActive();
  return active ? <File key={props.mediaAssetId} {...props} /> : null;
}
