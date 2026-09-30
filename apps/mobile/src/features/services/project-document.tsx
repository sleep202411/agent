import { webBaseUrl } from "@/config";
import { resolveDocumentLink } from "./production-document-links";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchProjectDocument } from "./project-document-api";
import { renderProductionDocument } from "./production-document-html";
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
  const [result, setResult] = useState<{
    revision: number;
    html?: string;
    links?: string[];
    error?: string;
  }>();
  const currentRevision = useRef(revision);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [linkError, setLinkError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchProjectDocument(props.crewId, props.userId, props.generation, controller.signal)
      .then((page) => renderProductionDocument(page.document))
      .then(
        (rendered) => {
          if (!controller.signal.aborted && props.generation === getAuthGeneration())
            setResult({ revision, ...rendered });
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
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setLinkError(undefined);
            currentRevision.current += 1;
            setRevision(currentRevision.current);
          }}
        >
          <ThemedText>{t("thread.refresh")}</ThemedText>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={props.onClose}>
          <ThemedText>{t("crewTasks.back")}</ThemedText>
        </Pressable>
      </View>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      {linkError && <ThemedText accessibilityRole="alert">{linkError}</ThemedText>}
      {visible?.html && (
        <ProductionDocumentView
          key={revision}
          title={t("projectDocument.title")}
          html={visible.html}
          onLink={(index) => {
            if (
              !mounted.current ||
              currentRevision.current !== revision ||
              props.generation !== getAuthGeneration()
            )
              return;
            const href = visible.links?.[index];
            if (href === undefined) return;
            const url = resolveDocumentLink(href, webBaseUrl);
            if (!url) {
              setLinkError(t("projectDocument.linkUnavailable"));
              return;
            }
            setLinkError(undefined);
            void Linking.openURL(url).catch(() => {
              if (
                mounted.current &&
                currentRevision.current === revision &&
                props.generation === getAuthGeneration()
              )
                setLinkError(t("projectDocument.linkOpenError"));
            });
          }}
          onError={() => {
            if (
              mounted.current &&
              currentRevision.current === revision &&
              props.generation === getAuthGeneration()
            )
              setResult({ revision, error: t("projectDocument.loadError") });
          }}
        />
      )}
    </View>
  );
}
