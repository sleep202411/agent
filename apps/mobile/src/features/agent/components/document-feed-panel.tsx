import { DocumentDiscussion } from "./document-discussion";
import { useUserDisplays } from "@/features/services/user-displays";
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
  userId = "",
  canComment = false,
  nodes = [],
  initialNodeId,
  close,
}: {
  documentId: string;
  generation: number;
  userId?: string;
  canComment?: boolean;
  nodes?: { id: string; title: string }[];
  initialNodeId?: string;
  close(): void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const active = useScreenActive();
  const [nodeId, setNodeId] = useState(initialNodeId);
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
        {nodeId && tab === "comments" && (
          <View style={{ gap: 4 }}>
            <ThemedText type="smallBold">
              {nodes.find((node) => node.id === nodeId)?.title || t("documentFeed.unavailableNode")}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              onPress={() => setNodeId(undefined)}
              style={{ paddingVertical: 10 }}
            >
              <ThemedText type="small">{t("documentFeed.allDiscussions")}</ThemedText>
            </Pressable>
          </View>
        )}
        {active && (
          <Feed
            key={`${documentId}:${generation}:${tab}`}
            documentId={documentId}
            generation={generation}
            kind={tab}
            userId={userId}
            canComment={canComment}
            nodes={nodes}
            nodeId={nodeId}
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
  userId,
  canComment,
  nodes,
  nodeId,
}: {
  documentId: string;
  generation: number;
  kind: "comments" | "history";
  userId: string;
  canComment: boolean;
  nodes: { id: string; title: string }[];
  nodeId?: string;
}) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const [rows, setRows] = useState<Rows>();
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const authorIds =
    rows?.kind === "comments"
      ? rows.items.flatMap((thread) => [
          thread.createdById,
          ...(thread.resolvedById ? [thread.resolvedById] : []),
          ...thread.comments.map((comment) => comment.createdById),
        ])
      : (rows?.items.map((version) => version.createdById) ?? []);
  const displays = useUserDisplays(rows ? `${generation}:${documentId}` : undefined, authorIds);
  const author = (id: string) =>
    displays?.get(id)?.nickname.trim() || t("documentFeed.unknownAuthor");
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
        {!loading &&
          !error &&
          (rows?.kind === "comments"
            ? rows.items.filter((thread) => !nodeId || thread.blockId === nodeId).length === 0
            : rows?.items.length === 0) && (
            <ThemedText type="small" themeColor="textSecondary">
              {t(kind === "comments" ? "documentFeed.noComments" : "documentFeed.noHistory")}
            </ThemedText>
          )}
        {kind === "comments" && (
          <DocumentDiscussion
            documentId={documentId}
            generation={generation}
            userId={userId}
            canComment={canComment}
            nodes={nodes}
            nodeId={nodeId}
            ready={!loading && !error && !!rows}
            threads={rows?.kind === "comments" ? rows.items : []}
            author={author}
            refresh={() => setRevision((n) => n + 1)}
          />
        )}
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
                {author(version.createdById)} · {t(`documentFeed.source.${version.source}`)} ·{" "}
                {new Date(version.createdAt).toLocaleString(locale)}
              </ThemedText>
            </View>
          ))}
      </ScrollView>
    </>
  );
}
