import { DocumentFeedPanel } from "./document-feed-panel";
import { StoryCanvasPositionForm } from "./story-canvas-position-form";
import {
  canvasPositionDraftStore,
  canvasPositionRecovery,
} from "../lib/story-canvas-position-draft";
import { StoryCanvasMap } from "./story-canvas-map";
import { StoryCanvasGroupForm } from "./story-canvas-group-form";
import { canvasGroupDraftStore } from "../lib/story-canvas-group-draft";
import { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/auth";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { useStoryChapterContext } from "../context/story-chapter-context";
import type { CandidateScope } from "../api/story-candidates-api";
import { StoryCanvasMediaSync } from "./story-canvas-media-sync";
import { StoryCanvasReader } from "./story-canvas-reader";
import { StoryCandidatesPanel } from "./story-candidates-panel";
import { StoryCanvasMediaForm } from "./story-canvas-media-form";
import { canvasMediaDraftStore } from "../lib/story-canvas-media-draft";
import { canvasDraftStore } from "../lib/story-canvas-draft";
import { CANVAS_SHOT_FIELDS, isCanvasShotOption } from "../../../../canvas-editor/shot-fields";
import { canvasOverview } from "../lib/story-canvas-overview";
import { canvasCreateDraftStore } from "../lib/story-canvas-create-draft";
import { StoryCanvasCreateForm } from "./story-canvas-create-form";
import { StoryCanvasEditForm } from "./story-canvas-edit-form";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import type { CanvasNodeEdit } from "../../../../canvas-editor/schema";

export function StoryCanvasEntry() {
  const context = useStoryChapterContext(),
    auth = useAuth(),
    active = useScreenActive(),
    t = useTranslations();
  const [open, setOpen] = useState(false);
  const scope = useMemo(
    () => ({ projectId: context.projectId, generation: auth.generation }),
    [context.projectId, auth.generation]
  );
  if (auth.status !== "authenticated" || !context.capabilities.includes("story.read")) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={context.loading || !!context.error}
        onPress={() => setOpen(true)}
        style={{ padding: 10 }}
      >
        <ThemedText type="small">{t("storyCanvas.title")}</ThemedText>
      </Pressable>
      {open && active && !context.loading && !context.error && (
        <StoryCanvasPanel
          key={`${scope.projectId}:${scope.generation}`}
          scope={scope}
          userId={String(auth.user?.userId ?? auth.user?.id ?? "")}
          canEdit={context.capabilities.includes("story.edit")}
          canComment={context.capabilities.includes("story.review")}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}
export function StoryCanvasPanel({
  scope,
  userId,
  canEdit,
  canComment = false,
  close,
}: {
  scope: CandidateScope;
  userId: string;
  canEdit: boolean;
  canComment?: boolean;
  close(): void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const [documentFeed, setDocumentFeed] = useState(false);
  const [positioning, setPositioning] = useState(false),
    [positionRecovery, setPositionRecovery] = useState(false);
  const [mapping, setMapping] = useState(false),
    [focusedNode, setFocusedNode] = useState<string>();
  const [grouping, setGrouping] = useState(false),
    [groupRecovery, setGroupRecovery] = useState(false);
  const [mediaNode, setMediaNode] = useState<string>();
  const [mediaRecovery, setMediaRecovery] = useState<string>();
  const [expandedShot, setExpandedShot] = useState<string>();
  const [creating, setCreating] = useState(false),
    [createRecovery, setCreateRecovery] = useState(false);
  const [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string>();
  const [overview, setOverview] = useState<ReturnType<typeof canvasOverview>>();
  const [loaded, setLoaded] = useState<CanvasLoaded>();
  const [recovery, setRecovery] = useState<Pick<CanvasNodeEdit, "nodeId" | "kind">>();
  const [edit, setEdit] = useState<Pick<CanvasNodeEdit, "nodeId" | "kind">>();
  const documentId = loaded?.documentId;
  const writeScope = useMemo(
    () => (documentId ? { ...scope, documentId } : undefined),
    [scope, documentId]
  );
  const [tab, setTab] = useState<"nodes" | "media">("nodes"),
    [selected, setSelected] = useState<string>();
  const reload = () => {
    setPositionRecovery(false);
    setFocusedNode(undefined);
    setGroupRecovery(false);
    setRecovery(undefined);
    setMediaRecovery(undefined);
    setCreateRecovery(false);
    setOverview(undefined);
    setLoaded(undefined);
    setError(undefined);
    setLoading(true);
    setAttempt((n) => n + 1);
  };
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
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
          <ThemedText type="smallBold">{t("storyCanvas.title")}</ThemedText>
          <Pressable accessibilityRole="button" onPress={close} style={{ padding: 12 }}>
            <ThemedText type="small">{t("agent.close")}</ThemedText>
          </Pressable>
        </View>
        {loading && <ActivityIndicator />}
        {loading && (
          <StoryCanvasReader
            key={attempt}
            scope={scope}
            title={t("storyCanvas.title")}
            runtimeError={t("storyCanvas.loadError")}
            onError={(message) => {
              setError(message);
              setLoading(false);
            }}
            onResult={(value) => {
              try {
                setOverview(canvasOverview(value.snapshot));
                setLoaded(value);
                const draft = canvasDraftStore(
                  { ...scope, documentId: value.documentId },
                  userId
                ).read();
                setRecovery(draft?.edit);
                setPositionRecovery(
                  !!canvasPositionDraftStore(
                    { ...scope, documentId: value.documentId },
                    userId
                  ).read()
                );
                setGroupRecovery(
                  !!canvasGroupDraftStore({ ...scope, documentId: value.documentId }, userId).read()
                );
                setMediaRecovery(
                  canvasMediaDraftStore({ ...scope, documentId: value.documentId }, userId).read()
                    ?.edit.nodeId
                );
                setCreateRecovery(
                  !!canvasCreateDraftStore(
                    { ...scope, documentId: value.documentId },
                    userId
                  ).read()
                );
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
              setLoading(false);
            }}
          />
        )}
        {error && (
          <ThemedText type="small" accessibilityRole="alert">
            {error}
          </ThemedText>
        )}
        {!loading && (
          <Pressable accessibilityRole="button" onPress={reload} style={{ paddingVertical: 10 }}>
            <ThemedText type="small">
              {t(error ? "common.retry" : "storyCanvas.refresh")}
            </ThemedText>
          </Pressable>
        )}
        {loaded && canEdit && !loading && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setCreating(true)}
            style={{ paddingVertical: 10 }}
          >
            <ThemedText type="small">
              {t(createRecovery ? "storyCanvas.resumeCreate" : "storyCanvas.create")}
            </ThemedText>
          </Pressable>
        )}
        {mediaRecovery && canEdit && !loading && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setMediaNode(mediaRecovery)}
            style={{ paddingVertical: 10 }}
          >
            <ThemedText type="small">{t("storyCanvas.media.resume")}</ThemedText>
          </Pressable>
        )}
        {recovery && canEdit && !loading && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setEdit(recovery)}
            style={{ paddingVertical: 10 }}
          >
            <ThemedText type="small">{t("storyCanvas.resumeAction")}</ThemedText>
          </Pressable>
        )}
        {writeScope &&
          canEdit &&
          !loading &&
          !error &&
          !edit &&
          !creating &&
          !mediaNode &&
          !grouping &&
          !mapping &&
          !positioning &&
          !selected &&
          !documentFeed && (
            <StoryCanvasMediaSync
              scope={writeScope}
              userId={userId}
              onSnapshot={(value) => {
                setOverview(canvasOverview(value.snapshot));
                setLoaded(value);
              }}
              onSaved={reload}
            />
          )}
        {loaded && !loading && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setGrouping(true)}
            style={{ paddingVertical: 10 }}
          >
            <ThemedText type="small">
              {t(
                groupRecovery && canEdit ? "storyCanvas.groups.resume" : "storyCanvas.groups.title"
              )}
            </ThemedText>
          </Pressable>
        )}
        {loaded && !loading && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setMapping(true)}
            style={{ paddingVertical: 10 }}
          >
            <ThemedText type="small">{t("storyCanvas.map.title")}</ThemedText>
          </Pressable>
        )}
        {loaded && !loading && !error && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setDocumentFeed(true)}
            style={{ paddingVertical: 10 }}
          >
            <ThemedText type="small">{t("documentFeed.title")}</ThemedText>
          </Pressable>
        )}
        {documentFeed && loaded && !loading && !error && (
          <DocumentFeedPanel
            key={`${loaded.documentId}:${scope.generation}`}
            documentId={loaded.documentId}
            generation={scope.generation}
            userId={userId}
            canComment={canComment}
            close={() => setDocumentFeed(false)}
          />
        )}
        {canEdit && positionRecovery && !loading && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setPositioning(true)}
            style={{ paddingVertical: 10 }}
          >
            <ThemedText type="small">{t("storyCanvas.map.resumeMovement")}</ThemedText>
          </Pressable>
        )}
        {focusedNode && tab === "nodes" && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setFocusedNode(undefined)}
            style={{ paddingVertical: 10 }}
          >
            <ThemedText type="small">{t("storyCanvas.map.allNodes")}</ThemedText>
          </Pressable>
        )}
        {overview && (
          <>
            <View style={{ flexDirection: "row", gap: 16 }}>
              {(["nodes", "media"] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: tab === value }}
                  onPress={() => setTab(value)}
                  style={{
                    paddingVertical: 10,
                    borderBottomWidth: tab === value ? 2 : 0,
                    borderColor: theme.brand,
                  }}
                >
                  <ThemedText type="small">
                    {t(value === "nodes" ? "storyCanvas.nodes" : "storyCanvas.media")} (
                    {value === "nodes" ? overview.nodes.length : overview.assets.length})
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 16 }}>
              {(tab === "nodes" ? overview.nodes.length === 0 : overview.assets.length === 0) && (
                <ThemedText type="small">{t("storyCanvas.empty")}</ThemedText>
              )}
              {tab === "nodes"
                ? overview.nodes
                    .filter((node) => !focusedNode || node.id === focusedNode)
                    .map((node) => (
                      <View
                        key={node.id}
                        style={{
                          padding: 12,
                          gap: 8,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: theme.border,
                        }}
                      >
                        <ThemedText type="smallBold">{node.title}</ThemedText>
                        {!!node.text && node.text !== node.title && (
                          <ThemedText type="small">{node.text}</ThemedText>
                        )}
                        {node.shotNumber != null && (
                          <ThemedText type="small">
                            {t("storyCanvas.shot.position")} {node.shotNumber}
                          </ThemedText>
                        )}
                        {node.type === "shot" && (
                          <>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityState={{ expanded: expandedShot === node.id }}
                              onPress={() =>
                                setExpandedShot(expandedShot === node.id ? undefined : node.id)
                              }
                              style={{ paddingVertical: 10 }}
                            >
                              <ThemedText type="small">{t("storyCanvas.shot.details")}</ThemedText>
                            </Pressable>
                            {expandedShot === node.id && (
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => setMediaNode(node.id)}
                                style={{ paddingVertical: 10 }}
                              >
                                <ThemedText type="small">{t("storyCanvas.media.title")}</ThemedText>
                              </Pressable>
                            )}
                            {expandedShot === node.id && canEdit && (
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => setEdit({ nodeId: node.id, kind: "reorderShot" })}
                                style={{ paddingVertical: 10 }}
                              >
                                <ThemedText type="small">
                                  {t("storyCanvas.shot.reorder")}
                                </ThemedText>
                              </Pressable>
                            )}
                            {expandedShot === node.id &&
                              CANVAS_SHOT_FIELDS.map((field) => {
                                const data = (
                                  loaded?.snapshot.nodes[node.id] as {
                                    data?: Record<string, unknown>;
                                  }
                                )?.data;
                                const value = data?.[field];
                                const display =
                                  value == null || value === ""
                                    ? t("storyCanvas.shot.unset")
                                    : isCanvasShotOption(field, value)
                                      ? t(`storyCanvas.shot.option.${value}`)
                                      : String(value);
                                return (
                                  <Pressable
                                    key={field}
                                    accessibilityRole="button"
                                    disabled={!canEdit}
                                    onPress={() => setEdit({ nodeId: node.id, kind: field })}
                                    style={{ paddingVertical: 8, gap: 4 }}
                                  >
                                    <ThemedText type="smallBold">
                                      {t(`storyCanvas.shot.${field}`)}
                                    </ThemedText>
                                    <ThemedText type="small" numberOfLines={2}>
                                      {display}
                                    </ThemedText>
                                  </Pressable>
                                );
                              })}
                          </>
                        )}
                        {canEdit && (
                          <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => setEdit({ nodeId: node.id, kind: "remove" })}
                              style={{ paddingVertical: 10 }}
                            >
                              <ThemedText type="small">{t("storyCanvas.remove")}</ThemedText>
                            </Pressable>
                            {node.canRename && (
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => setEdit({ nodeId: node.id, kind: "rename" })}
                                style={{ paddingVertical: 10 }}
                              >
                                <ThemedText type="small">{t("storyCanvas.rename")}</ThemedText>
                              </Pressable>
                            )}
                            {node.canEditText && (
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => setEdit({ nodeId: node.id, kind: "text" })}
                                style={{ paddingVertical: 10 }}
                              >
                                <ThemedText type="small">{t("storyCanvas.editNote")}</ThemedText>
                              </Pressable>
                            )}
                            {node.canEditPrompt && (
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => setEdit({ nodeId: node.id, kind: "prompt" })}
                                style={{ paddingVertical: 10 }}
                              >
                                <ThemedText type="small">{t("storyCanvas.editPrompt")}</ThemedText>
                              </Pressable>
                            )}
                          </View>
                        )}
                      </View>
                    ))
                : overview.assets.map((asset) => (
                    <View
                      key={asset.id}
                      style={{
                        padding: 12,
                        gap: 8,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: theme.border,
                      }}
                    >
                      <ThemedText type="smallBold">
                        {asset.name || t(`storyCanvas.${asset.kind}`)}
                      </ThemedText>
                      <ThemedText type="small">{t(`storyCanvas.${asset.kind}`)}</ThemedText>
                      {canEdit && asset.mediaAssetId && (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => setSelected(asset.mediaAssetId)}
                          style={{ paddingVertical: 10 }}
                        >
                          <ThemedText type="small">{t("storyCanvas.saveCandidate")}</ThemedText>
                        </Pressable>
                      )}
                    </View>
                  ))}
            </ScrollView>
          </>
        )}
        {mapping && loaded && (
          <StoryCanvasMap
            loaded={loaded}
            move={
              canEdit && writeScope
                ? (edit) => {
                    canvasPositionRecovery(writeScope, userId).stage(loaded.snapshot, edit);
                    setMapping(false);
                    setPositioning(true);
                  }
                : undefined
            }
            close={() => setMapping(false)}
            inspect={(nodeId) => {
              setMapping(false);
              setFocusedNode(nodeId);
              setExpandedShot(nodeId);
              setTab("nodes");
            }}
          />
        )}
        {positioning && writeScope && loaded && (
          <StoryCanvasPositionForm
            loaded={loaded}
            scope={writeScope}
            userId={userId}
            canEdit={canEdit}
            close={() => {
              setPositioning(false);
              reload();
            }}
            saved={() => {
              setPositioning(false);
              reload();
            }}
          />
        )}
        {grouping && loaded && writeScope && (
          <StoryCanvasGroupForm
            scope={writeScope}
            userId={userId}
            loaded={loaded}
            canEdit={canEdit}
            close={() => {
              setGrouping(false);
              reload();
            }}
            saved={() => {
              setGrouping(false);
              reload();
            }}
          />
        )}
        {selected && (
          <StoryCandidatesPanel
            scope={scope}
            userId={userId}
            mediaAssetId={selected}
            close={() => setSelected(undefined)}
          />
        )}
        {mediaNode && loaded && writeScope && (
          <StoryCanvasMediaForm
            scope={writeScope}
            userId={userId}
            loaded={loaded}
            nodeId={mediaNode}
            canEdit={canEdit}
            close={() => {
              setMediaNode(undefined);
              reload();
            }}
            saved={() => {
              setMediaNode(undefined);
              reload();
            }}
          />
        )}
        {creating && writeScope && canEdit && (
          <StoryCanvasCreateForm
            scope={writeScope}
            userId={userId}
            close={() => {
              setCreating(false);
              reload();
            }}
            saved={() => {
              setCreating(false);
              reload();
            }}
          />
        )}
        {edit && loaded && writeScope && canEdit && (
          <StoryCanvasEditForm
            scope={writeScope}
            userId={userId}
            loaded={loaded}
            edit={edit}
            close={() => {
              setEdit(undefined);
              reload();
            }}
            saved={() => {
              setEdit(undefined);
              reload();
            }}
          />
        )}
      </View>
    </Modal>
  );
}
