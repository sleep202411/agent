import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { useLocale, useTranslations } from "@/i18n";
import {
  listDocumentThreads,
  listDocumentVersions,
  type DocumentThread,
  type DocumentVersion,
} from "../api/document-feeds-api";

type Rows =
  | { kind: "comments"; items: DocumentThread[] }
  | { kind: "history"; items: DocumentVersion[] };
export function DocumentFeedPanel({
  documentId,
  generation,
  close,
}: {
  documentId: string;
  generation: number;
  close(): void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const active = useScreenActive();
  const [tab, setTab] = useState<"comments" | "history">("comments");
  return (
    <Modal visible={active} animationType="slide" onRequestClose={close}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 12,
          paddingHorizontal: 16,
          gap: 12,
        }}
      >
        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
        >
          <ThemedText type="smallBold">{t("documentFeed.title")}</ThemedText>
          <Pressable accessibilityRole="button" onPress={close} style={{ padding: 12 }}>
            <ThemedText type="small">{t("agent.close")}</ThemedText>
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", gap: 16 }}>
          {(["comments", "history"] as const).map((kind) => (
            <Pressable
              key={kind}
              accessibilityRole="button"
              accessibilityState={{ selected: tab === kind }}
              onPress={() => setTab(kind)}
              style={{
                paddingVertical: 12,
                borderBottomWidth: tab === kind ? 2 : 0,
                borderColor: theme.brand,
              }}
            >
              <ThemedText type="small">{t(`documentFeed.${kind}`)}</ThemedText>
            </Pressable>
          ))}
        </View>
        {active && (
          <Feed
            key={`${documentId}:${generation}:${tab}`}
            documentId={documentId}
            generation={generation}
            kind={tab}
          />
        )}
      </View>
    </Modal>
  );
}
function Feed({
  documentId,
  generation,
  kind,
}: {
  documentId: string;
  generation: number;
  kind: "comments" | "history";
}) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const [rows, setRows] = useState<Rows>();
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false;
    let controller: AbortController | undefined;
    const read = async () => {
      if (controller) return;
      const c = new AbortController();
      controller = c;
      setLoading(true);
      try {
        const next: Rows =
          kind === "comments"
            ? { kind, items: await listDocumentThreads(documentId, generation, c.signal) }
            : { kind, items: await listDocumentVersions(documentId, generation, c.signal) };
        if (!disposed && !c.signal.aborted) {
          setRows(next);
          setError(undefined);
        }
      } catch (cause) {
        if (disposed || c.signal.aborted) return;
        const status =
          typeof cause === "object" && cause !== null && "status" in cause
            ? cause.status
            : undefined;
        if ([401, 403, 404, 410].includes(Number(status))) setRows(undefined);
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!disposed && !c.signal.aborted) setLoading(false);
        if (controller === c) controller = undefined;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 15000);
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(timer);
    };
  }, [documentId, generation, kind, revision]);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={loading}
        onPress={() => setRevision((n) => n + 1)}
        style={{ paddingVertical: 10 }}
      >
        <ThemedText type="small">{t(error ? "common.retry" : "documentFeed.refresh")}</ThemedText>
      </Pressable>
      {loading && <ActivityIndicator />}
      {error && (
        <ThemedText type="small" accessibilityRole="alert">
          {error}
        </ThemedText>
      )}
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 16 }}>
        {!loading && !error && rows?.items.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            {t(kind === "comments" ? "documentFeed.noComments" : "documentFeed.noHistory")}
          </ThemedText>
        )}
        {rows?.kind === "comments" &&
          rows.items.map((thread) => (
            <View
              key={thread.id}
              style={{
                gap: 8,
                padding: 12,
                borderRadius: 8,
                backgroundColor: theme.backgroundElement,
              }}
            >
              <ThemedText type="smallBold">
                {thread.title || t("documentFeed.thread")} ·{" "}
                {t(thread.status === "open" ? "documentFeed.open" : "documentFeed.resolved")}
              </ThemedText>
              {thread.blockId && (
                <ThemedText type="small" themeColor="textSecondary">
                  {t("documentFeed.node")} {thread.blockId}
                </ThemedText>
              )}
              {thread.comments.map((comment) => (
                <View key={comment.id} style={{ gap: 4 }}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {new Date(comment.createdAt).toLocaleString(locale)}
                  </ThemedText>
                  <ThemedText type="small" selectable>
                    {comment.body}
                  </ThemedText>
                </View>
              ))}
            </View>
          ))}
        {rows?.kind === "history" &&
          rows.items.map((version) => (
            <View
              key={version.id}
              style={{
                gap: 4,
                padding: 12,
                borderRadius: 8,
                backgroundColor: theme.backgroundElement,
              }}
            >
              <ThemedText type="smallBold">
                {t("documentFeed.version")} {version.versionNumber}
                {version.label ? ` · ${version.label}` : ""}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t(`documentFeed.source.${version.source}`)} ·{" "}
                {new Date(version.createdAt).toLocaleString(locale)}
              </ThemedText>
            </View>
          ))}
      </ScrollView>
    </>
  );
}
