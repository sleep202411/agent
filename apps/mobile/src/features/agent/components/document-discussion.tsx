import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import { z } from "zod";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import {
  documentCommentPending,
  writeDocumentComment,
  type DocumentCommentCommand,
} from "../api/document-comments-api";
import type { DocumentThread } from "../api/document-feeds-api";
const draftSchema = z.object({
  target: z.string(),
  body: z.string().max(5000),
  title: z.string().max(160),
  blockId: z.string().max(128),
});
type Draft = z.infer<typeof draftSchema>;
export function DocumentDiscussion({
  documentId,
  generation,
  userId,
  canComment,
  ready,
  nodes,
  threads,
  author,
  refresh,
}: {
  documentId: string;
  generation: number;
  userId: string;
  canComment: boolean;
  ready: boolean;
  nodes: { id: string; title: string }[];
  threads: DocumentThread[];
  author(id: string): string;
  refresh(): void;
}) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const [storage] = useState(() => durableRecord("document-comment-draft", userId, documentId));
  const [initial] = useState(() => {
    try {
      const raw = storage.read();
      return {
        draft: raw ? draftSchema.nullable().parse(JSON.parse(raw)) : null,
        pending: documentCommentPending(documentId, userId, generation).read(),
      };
    } catch (cause) {
      return {
        draft: null,
        pending: null,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  });
  const [draft, setDraft] = useState<Draft | null>(initial.draft);
  const [pending, setPending] = useState(initial.pending);
  const [error, setError] = useState(initial.error);
  const [busy, setBusy] = useState(false);
  const [choosingNode, setChoosingNode] = useState(false);
  const [nodeQuery, setNodeQuery] = useState("");
  const nodeLabel = (id: string) =>
    nodes.find((node) => node.id === id)?.title || t("documentFeed.unavailableNode");
  const active = useRef(true),
    operation = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      operation.current?.abort();
    };
  }, []);
  const access = useRef({ ready, canComment });
  useLayoutEffect(() => {
    access.current = { ready, canComment };
  }, [ready, canComment]);
  const current = () => active.current && generation === getAuthGeneration();
  const save = (next: Draft | null) => {
    if (!current() || operation.current) return;
    try {
      storage.write(JSON.stringify(next));
      setDraft(next);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const locked = busy || !!pending || !!initial.error || !ready || !canComment;
  const send = async (command: DocumentCommentCommand) => {
    if (
      !current() ||
      operation.current ||
      locked ||
      !access.current.ready ||
      !access.current.canComment
    )
      return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      await writeDocumentComment(command, documentId, userId, generation, controller.signal, () => {
        if (command.kind !== "resolve") storage.write("null");
      });
      if (!current()) return;
      if (command.kind !== "resolve") setDraft(null);
      setPending(null);
      refresh();
    } catch (cause) {
      if (!current()) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      try {
        setPending(documentCommentPending(documentId, userId, generation).read());
      } catch (readError) {
        setError(String(readError));
      }
      refresh();
    } finally {
      if (operation.current === controller) operation.current = null;
      if (current()) setBusy(false);
    }
  };
  const field = (key: "body" | "title" | "blockId", maxLength: number) => (
    <TextInput
      accessibilityLabel={t(`documentFeed.${key === "title" ? "threadTitle" : key}`)}
      placeholder={t(`documentFeed.${key === "title" ? "threadTitle" : key}`)}
      placeholderTextColor={theme.textSecondary}
      value={draft?.[key]}
      editable={!locked}
      maxLength={maxLength}
      multiline={key === "body"}
      onChangeText={(value) => draft && save({ ...draft, [key]: value })}
      style={{
        color: theme.text,
        padding: 10,
        minHeight: key === "body" ? 100 : 44,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
      }}
    />
  );
  return (
    <View style={{ gap: 12 }}>
      {pending && (
        <View style={{ gap: 6 }}>
          <ThemedText type="small">{t("documentFeed.uncertain")}</ThemedText>
          {pending.kind !== "resolve" && (
            <ThemedText type="small" selectable>
              {pending.body}
            </ThemedText>
          )}
          {
            <DiscussionAction
              label={t("documentFeed.reviewed")}
              onPress={() =>
                Alert.alert(t("documentFeed.reviewed"), t("documentFeed.reviewHint"), [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("documentFeed.reviewed"),
                    onPress: () => {
                      if (!current() || !access.current.ready || operation.current) return;
                      try {
                        storage.write("null");
                        documentCommentPending(documentId, userId, generation).clear(
                          pending.clientKey
                        );
                        setDraft(null);
                        setPending(null);
                        setError(undefined);
                      } catch (cause) {
                        setError(String(cause));
                      }
                    },
                  },
                ])
              }
              disabled={busy || !ready}
            />
          }
        </View>
      )}
      {canComment && !draft && !pending && (
        <DiscussionAction
          label={t("documentFeed.newThread")}
          onPress={() => save({ target: "new", body: "", title: "", blockId: "" })}
          disabled={locked}
        />
      )}
      {draft && (
        <View style={{ gap: 8 }}>
          <ThemedText type="smallBold">
            {t(draft.target === "new" ? "documentFeed.newThread" : "documentFeed.reply")}
          </ThemedText>
          {draft.target === "new" && (
            <>
              {field("title", 160)}
              <DiscussionAction
                label={draft.blockId ? nodeLabel(draft.blockId) : t("documentFeed.wholeDocument")}
                onPress={() => setChoosingNode((value) => !value)}
                disabled={locked}
              />
              {choosingNode && (
                <View style={{ gap: 4 }}>
                  <TextInput
                    accessibilityLabel={t("documentFeed.findNode")}
                    placeholder={t("documentFeed.findNode")}
                    placeholderTextColor={theme.textSecondary}
                    value={nodeQuery}
                    onChangeText={setNodeQuery}
                    style={{
                      color: theme.text,
                      padding: 10,
                      backgroundColor: theme.backgroundElement,
                      borderRadius: 8,
                    }}
                  />
                  <DiscussionAction
                    label={t("documentFeed.wholeDocument")}
                    disabled={locked}
                    onPress={() => {
                      save({ ...draft, blockId: "" });
                      setChoosingNode(false);
                    }}
                  />
                  {nodes
                    .filter((node) =>
                      node.title
                        .toLocaleLowerCase(locale)
                        .includes(nodeQuery.trim().toLocaleLowerCase(locale))
                    )
                    .map((node) => (
                      <DiscussionAction
                        key={node.id}
                        label={node.title}
                        disabled={locked}
                        onPress={() => {
                          save({ ...draft, blockId: node.id });
                          setChoosingNode(false);
                        }}
                      />
                    ))}
                </View>
              )}
              {!!draft.blockId && !nodes.some((node) => node.id === draft.blockId) && (
                <ThemedText type="small">{t("documentFeed.chooseAnotherNode")}</ThemedText>
              )}
            </>
          )}
          {field("body", 5000)}
          {
            <DiscussionAction
              label={t("documentFeed.send")}
              onPress={() => {
                const base = { clientKey: uuid.v4(), documentId };
                void send(
                  draft.target === "new"
                    ? {
                        ...base,
                        kind: "create",
                        body: draft.body,
                        ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
                        ...(draft.blockId.trim() ? { blockId: draft.blockId.trim() } : {}),
                      }
                    : { ...base, kind: "reply", threadId: draft.target, body: draft.body }
                );
              }}
              disabled={
                locked ||
                !draft.body.trim() ||
                (draft.target === "new" &&
                  !!draft.blockId &&
                  !nodes.some((node) => node.id === draft.blockId)) ||
                (draft.target !== "new" && !threads.some((thread) => thread.id === draft.target))
              }
            />
          }
          {
            <DiscussionAction
              label={t("documentFeed.discard")}
              onPress={() =>
                Alert.alert(t("documentFeed.discard"), t("documentFeed.discardHint"), [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("documentFeed.discard"),
                    style: "destructive",
                    onPress: () => save(null),
                  },
                ])
              }
              disabled={busy || !!pending}
            />
          }
        </View>
      )}
      {error && (
        <ThemedText accessibilityRole="alert" type="small">
          {error}
        </ThemedText>
      )}
      {threads.map((thread) => (
        <View
          key={thread.id}
          style={{ gap: 8, padding: 12, borderRadius: 8, backgroundColor: theme.backgroundElement }}
        >
          <ThemedText type="smallBold">
            {thread.title || t("documentFeed.thread")} ·{" "}
            {t(thread.status === "open" ? "documentFeed.open" : "documentFeed.resolved")}
          </ThemedText>
          {thread.status === "resolved" && thread.resolvedById && (
            <ThemedText type="small" themeColor="textSecondary">
              {t("documentFeed.resolvedBy")} {author(thread.resolvedById)}
            </ThemedText>
          )}
          {thread.blockId && (
            <ThemedText type="small" themeColor="textSecondary">
              {t("documentFeed.node")} {nodeLabel(thread.blockId)}
            </ThemedText>
          )}
          {thread.comments.map((comment) => (
            <View key={comment.id} style={{ gap: 4 }}>
              <ThemedText type="small" themeColor="textSecondary">
                {author(comment.createdById)} · {new Date(comment.createdAt).toLocaleString(locale)}
              </ThemedText>
              <ThemedText type="small" selectable>
                {comment.body}
              </ThemedText>
            </View>
          ))}
          {canComment && (
            <View style={{ flexDirection: "row", gap: 16 }}>
              {
                <DiscussionAction
                  label={t("documentFeed.reply")}
                  onPress={() => save({ target: thread.id, body: "", title: "", blockId: "" })}
                  disabled={locked || !!draft}
                />
              }
              {thread.status === "open" && (
                <DiscussionAction
                  label={t("documentFeed.resolve")}
                  onPress={() =>
                    Alert.alert(t("documentFeed.resolve"), t("documentFeed.resolveHint"), [
                      { text: t("common.cancel"), style: "cancel" },
                      {
                        text: t("documentFeed.resolve"),
                        onPress: () => {
                          void send({
                            kind: "resolve",
                            clientKey: uuid.v4(),
                            documentId,
                            threadId: thread.id,
                          });
                        },
                      },
                    ])
                  }
                  disabled={locked || !!draft}
                />
              )}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function DiscussionAction({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress(): void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ paddingVertical: 10, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
