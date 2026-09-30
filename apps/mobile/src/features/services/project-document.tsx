import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchProjectDocument } from "./project-document-api";
import { productionDocumentHtml } from "./production-document-html";
import { ProductionDocumentView } from "./production-document-view";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function ProjectDocument(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ revision: number; html?: string; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchProjectDocument(props.crewId, props.userId, props.generation, controller.signal)
      .then((page) => productionDocumentHtml(page.document))
      .then(
        (html) => {
          if (!controller.signal.aborted && props.generation === getAuthGeneration())
            setResult({ revision, html });
        },
        (error) => {
          if (!controller.signal.aborted && props.generation === getAuthGeneration())
            setResult({ revision, error: error instanceof Error ? error.message : String(error) });
        }
      );
    return () => controller.abort();
  }, [props.crewId, props.userId, props.generation, revision]);
  const visible = result?.revision === revision ? result : undefined;
  return (
    <View style={{ flex: 1, gap: 12, padding: 16 }}>
      <ThemedText type="smallBold">{t("projectDocument.title")}</ThemedText>
      <ThemedText>{t("projectDocument.readOnly")}</ThemedText>
      <View style={{ flexDirection: "row", gap: 16 }}>
        <Pressable accessibilityRole="button" onPress={() => setRevision((v) => v + 1)}>
          <ThemedText>{t("thread.refresh")}</ThemedText>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={props.onClose}>
          <ThemedText>{t("crewTasks.back")}</ThemedText>
        </Pressable>
      </View>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      {visible?.html && (
        <ProductionDocumentView
          key={revision}
          title={t("projectDocument.title")}
          html={visible.html}
          onError={() => setResult({ revision, error: t("projectDocument.loadError") })}
        />
      )}
    </View>
  );
}
