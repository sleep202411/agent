import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useLocale, useTranslations } from "@/i18n";
import {
  fetchTaskContractDownload,
  contractSession,
  type TaskContractFile,
} from "./task-contract-files-api";
export function ContractFileRow({
  file,
  generation,
}: {
  file: TaskContractFile;
  generation: number;
}) {
  const t = useTranslations(),
    locale = useLocale(),
    active = useScreenActive();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null),
    inFlight = useRef(false);
  useEffect(() => {
    if (!active) return;
    const c = new AbortController();
    controller.current = c;
    return () => {
      c.abort();
      controller.current = null;
    };
  }, [active, file.id, generation]);
  return (
    <View style={{ gap: 6, paddingVertical: 12 }}>
      <ThemedText type="smallBold">{file.name}</ThemedText>
      <ThemedText type="small">{t("taskContractFiles.readOnly")}</ThemedText>
      {file.attachedAt && (
        <ThemedText type="small">{new Date(file.attachedAt).toLocaleDateString(locale)}</ThemedText>
      )}
      {file.sizeBytes !== null && (
        <ThemedText type="small">
          {t("taskContractFiles.bytes").replace(
            "{count}",
            BigInt(file.sizeBytes).toLocaleString(locale)
          )}
        </ThemedText>
      )}
      {!file.available ? (
        <ThemedText type="small">{t("taskContractFiles.unavailable")}</ThemedText>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={busy || !active}
          style={{ minHeight: 44, justifyContent: "center" }}
          onPress={async () => {
            const c = controller.current;
            if (!c || c.signal.aborted || inFlight.current) return;
            inFlight.current = true;
            setBusy(true);
            setError("");
            try {
              const url = await fetchTaskContractDownload(file.id, generation, c.signal);
              contractSession(generation, c.signal);
              await Linking.openURL(url);
            } catch (cause) {
              if (!c.signal.aborted)
                setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
              inFlight.current = false;
              setBusy(false);
            }
          }}
        >
          <ThemedText>{t("taskContractFiles.download")}</ThemedText>
        </Pressable>
      )}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    </View>
  );
}
