import { CanvasStoryboard } from "./canvas-storyboard";
import { useCallback, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuth } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import type { CanvasNodeEdit } from "../../../../canvas-editor/schema";
import { CANVAS_SHOT_FIELDS } from "../../../../canvas-editor/shot-fields";
import { canvasDraftStore } from "../lib/story-canvas-draft";
import { fetchPlatformSections } from "../api/platform-sections-api";
import { StoryCanvasPositionForm } from "./story-canvas-position-form";
import { StoryCanvasGroupForm } from "./story-canvas-group-form";
import {
  canvasPositionDraftStore,
  canvasPositionRecovery,
} from "../lib/story-canvas-position-draft";
import { canvasGroupDraftStore } from "../lib/story-canvas-group-draft";
import { StoryCanvasCreateForm } from "./story-canvas-create-form";
import { canvasCreateDraftStore } from "../lib/story-canvas-create-draft";
import { StoryCanvasMediaLibrary } from "./story-canvas-media-library";
import { StoryPanoramaPreview } from "./story-panorama-preview";
import type { CanvasPanoramaSource } from "../api/story-canvas-panorama";
import { StoryCanvasEditForm } from "./story-canvas-edit-form";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import {
  openPlatformCanvasDocument,
  type PlatformCanvasScope,
} from "../api/platform-canvas-document";
import { canvasOverview } from "../lib/story-canvas-overview";
import { StoryCanvasReader } from "./story-canvas-reader";
import { StoryCanvasMap } from "./story-canvas-map";
import { StoryCanvasMediaPreview, type CanvasMediaTarget } from "./story-canvas-media-preview";
import { StoryCanvasGenerationPanel } from "./story-canvas-generation-panel";
import { StoryCanvasMediaForm } from "./story-canvas-media-form";
import { canvasMediaDraftStore } from "../lib/story-canvas-media-draft";
import { StoryCanvasMediaSync } from "./story-canvas-media-sync";
import { PlatformActorsPanel } from "./platform-actors-panel";

export function PlatformCanvasPanel({
  scope,
  title,
  close,
}: {
  scope: PlatformCanvasScope;
  title: string;
  close(): void;
}) {
  const active = useScreenActive();
  return active && scope.generation === getAuthGeneration() ? (
    <Session
      key={`${scope.projectId}:${scope.sectionId}:${scope.documentId}:${scope.generation}`}
      scope={scope}
      title={title}
      close={close}
    />
  ) : null;
}
function Session({
  scope,
  title,
  close,
}: {
  scope: PlatformCanvasScope;
  title: string;
  close(): void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const [revision, setRevision] = useState(0);
  const auth = useAuth();
  const [actors, setActors] = useState(false);
  if (auth.status !== "authenticated" || auth.generation !== scope.generation) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <View style={{ padding: 16, gap: 8 }}>
          <ThemedText type="smallBold">{title}</ThemedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <Pressable accessibilityRole="button" onPress={close} style={{ padding: 8 }}>
              <ThemedText type="small">{t("agent.close")}</ThemedText>
            </Pressable>
            {!actors && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setRevision((n) => n + 1)}
                style={{ padding: 8 }}
              >
                <ThemedText type="small">{t("storyCanvas.refresh")}</ThemedText>
              </Pressable>
            )}
          </View>
        </View>
        {actors && auth.status === "authenticated" ? (
          <PlatformActorsPanel
            scope={scope}
            userId={String(auth.user?.userId ?? auth.user?.id ?? "")}
            close={() => setActors(false)}
            saved={() => {
              setActors(false);
              setRevision((n) => n + 1);
            }}
          />
        ) : (
          <Document
            key={revision}
            userId={String(auth.user?.userId ?? auth.user?.id ?? "")}
            saved={() => setRevision((n) => n + 1)}
            scope={scope}
            openActors={auth.status === "authenticated" ? () => setActors(true) : undefined}
          />
        )}
      </View>
    </Modal>
  );
}
function Document({
  scope,
  openActors,
  userId,
  saved,
}: {
  scope: PlatformCanvasScope;
  openActors?: () => void;
  userId: string;
  saved(): void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [mediaNode, setMediaNode] = useState<string>();
  const [mediaRecovery, setMediaRecovery] = useState<string>();
  const [generationCard, setGenerationCard] = useState<{ id: string; title: string }>();
  const [creating, setCreating] = useState(false);
  const [createRecovery, setCreateRecovery] = useState(false);
  const [libraryAsset, setLibraryAsset] = useState<{ id: string; name?: string }>();
  const [tab, setTab] = useState<"nodes" | "media">("nodes");
  const [panorama, setPanorama] = useState<CanvasPanoramaSource>();
  const [positioning, setPositioning] = useState(false);
  const [grouping, setGrouping] = useState(false);
  const [positionRecovery, setPositionRecovery] = useState(false);
  const [groupRecovery, setGroupRecovery] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [edit, setEdit] = useState<Pick<CanvasNodeEdit, "nodeId" | "kind">>();
  const [recovery, setRecovery] = useState<Pick<CanvasNodeEdit, "nodeId" | "kind">>();
  const [actions, setActions] = useState<string>();
  const load = useCallback(async (currentScope: PlatformCanvasScope, signal: AbortSignal) => {
    const result = await openPlatformCanvasDocument(currentScope, signal);
    const sections = await fetchPlatformSections(
      currentScope.projectId,
      currentScope.workspaceId,
      currentScope.generation,
      signal
    );
    signal.throwIfAborted();
    if (getAuthGeneration() !== currentScope.generation) throw Error("Canvas session expired.");
    if (
      !sections.sections.some(
        (row) =>
          row.id === currentScope.sectionId && row.canvasDocumentId === currentScope.documentId
      )
    )
      throw Error("Canvas no longer belongs to the selected chapter.");
    setCanEdit(sections.canEdit);
    return result;
  }, []);
  const [loaded, setLoaded] = useState<CanvasLoaded>();
  const [overview, setOverview] = useState<ReturnType<typeof canvasOverview>>();
  const [error, setError] = useState<string>();
  const [mediaPreview, setMediaPreview] = useState<CanvasMediaTarget>();
  const [mapping, setMapping] = useState(false);
  const [selected, setSelected] = useState<string>();
  return (
    <>
      {!loaded && !error && (
        <>
          <ActivityIndicator />
          <StoryCanvasReader
            scope={scope}
            platform={{ scope, load }}
            title={t("storyCanvas.title")}
            runtimeError={t("storyCanvas.loadError")}
            onResult={(result) => {
              try {
                setOverview(canvasOverview(result.snapshot));
                setRecovery(canvasDraftStore(scope, userId).read()?.edit);
                setMediaRecovery(canvasMediaDraftStore(scope, userId).read()?.edit.nodeId);
                setPositionRecovery(!!canvasPositionDraftStore(scope, userId).read());
                setGroupRecovery(!!canvasGroupDraftStore(scope, userId).read());
                setCreateRecovery(!!canvasCreateDraftStore(scope, userId).read());
                setLoaded(result);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
            onError={setError}
          />
        </>
      )}
      {error && (
        <ThemedText accessibilityRole="alert" style={{ padding: 16 }}>
          {error}
        </ThemedText>
      )}
      {loaded && overview && (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <CanvasStoryboard
            loaded={loaded}
            scope={scope}
            userId={userId}
            canEdit={canEdit}
            saved={saved}
          />
          {canEdit &&
            !error &&
            !generationCard &&
            !mediaNode &&
            !creating &&
            !edit &&
            !grouping &&
            !positioning &&
            !mapping &&
            !panorama &&
            !mediaPreview && (
              <StoryCanvasMediaSync
                scope={scope}
                userId={userId}
                onSnapshot={(value) => {
                  setOverview(canvasOverview(value.snapshot));
                  setLoaded(value);
                }}
                onSaved={saved}
              />
            )}
          {canEdit && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setLibraryAsset(undefined);
                setCreating(true);
              }}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <ThemedText type="small">
                {t(createRecovery ? "storyCanvas.resumeCreate" : "storyCanvas.create")}
              </ThemedText>
            </Pressable>
          )}
          {canEdit && mediaRecovery && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setMediaNode(mediaRecovery)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <ThemedText type="small">{t("storyCanvas.media.resume")}</ThemedText>
            </Pressable>
          )}
          {canEdit && recovery && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setEdit(recovery)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <ThemedText type="small">{t("storyCanvas.resumeAction")}</ThemedText>
            </Pressable>
          )}
          {canEdit && positionRecovery && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setPositioning(true)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <ThemedText type="small">{t("storyCanvas.map.resumeMovement")}</ThemedText>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => setGrouping(true)}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <ThemedText type="small">
              {t(
                groupRecovery && canEdit ? "storyCanvas.groups.resume" : "storyCanvas.groups.title"
              )}
            </ThemedText>
          </Pressable>
          {openActors && (
            <Pressable accessibilityRole="button" onPress={openActors} style={{ padding: 10 }}>
              <ThemedText type="small">{t("platformActors.title")}</ThemedText>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => setMapping(true)}
            style={{ padding: 10 }}
          >
            <ThemedText type="small">{t("storyCanvas.map.title")}</ThemedText>
          </Pressable>
          <View style={{ flexDirection: "row", gap: 16 }}>
            {(["nodes", "media"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === value }}
                onPress={() => setTab(value)}
                style={{
                  minHeight: 44,
                  justifyContent: "center",
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
          <StoryCanvasMediaLibrary
            assets={overview.assets}
            visible={tab === "media"}
            canEdit={canEdit}
            onAdd={(asset) => {
              setLibraryAsset(asset);
              setCreating(true);
            }}
            onPreview={(asset) => setMediaPreview({ assetId: asset.id })}
            onPreviewPanorama={(asset) =>
              setPanorama({
                title: asset.name || t("storyCanvas.panorama.title"),
                url: asset.url,
                mediaAssetId: asset.mediaAssetId,
              })
            }
          />
          {tab === "nodes" && !overview.nodes.length && (
            <ThemedText type="small">{t("storyCanvas.empty")}</ThemedText>
          )}
          {tab === "nodes" &&
            (selected ? overview.nodes.filter((node) => node.id === selected) : overview.nodes).map(
              (node) => (
                <View
                  key={node.id}
                  style={{
                    backgroundColor: theme.backgroundElement,
                    padding: 12,
                    borderRadius: 8,
                    gap: 8,
                  }}
                >
                  <ThemedText type="smallBold">{node.title}</ThemedText>
                  {node.media.map((media, index) => (
                    <Pressable
                      key={media.id}
                      accessibilityRole="button"
                      onPress={() =>
                        setMediaPreview({ node: { nodeId: node.id, mediaKey: media.id } })
                      }
                      style={{ minHeight: 44, justifyContent: "center" }}
                    >
                      <ThemedText type="small">
                        {t("storyCandidates.preview")}
                        {node.media.length > 1 ? ` ${index + 1}` : ""}
                      </ThemedText>
                    </Pressable>
                  ))}
                  {node.panorama && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setPanorama(node.panorama)}
                      style={{ minHeight: 44, justifyContent: "center" }}
                    >
                      <ThemedText type="small">{t("storyCanvas.panorama.open")}</ThemedText>
                    </Pressable>
                  )}
                  {(node.type === "shot" || node.canEditPrompt) && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setMediaNode(node.id)}
                      style={{ minHeight: 44, justifyContent: "center" }}
                    >
                      <ThemedText type="small">
                        {t(
                          node.type === "shot"
                            ? "storyCanvas.media.title"
                            : "storyCanvas.referencesTitle"
                        )}
                      </ThemedText>
                    </Pressable>
                  )}
                  {canEdit && node.canEditPrompt && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setGenerationCard({ id: node.id, title: node.title })}
                      style={{ minHeight: 44, justifyContent: "center" }}
                    >
                      <ThemedText type="small">{t("aiLab.generate")}</ThemedText>
                    </Pressable>
                  )}
                  {canEdit && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: actions === node.id }}
                      onPress={() => setActions(actions === node.id ? undefined : node.id)}
                      style={{ minHeight: 44, justifyContent: "center" }}
                    >
                      <ThemedText type="small">{t("platformCanvas.editCard")}</ThemedText>
                    </Pressable>
                  )}
                  {canEdit && actions === node.id && (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                      {(
                        [
                          ...(node.canRename
                            ? [{ kind: "rename", label: "storyCanvas.rename" }]
                            : []),
                          ...(node.canEditText
                            ? [{ kind: "text", label: "storyCanvas.editNote" }]
                            : []),
                          ...(node.canEditPrompt
                            ? [{ kind: "prompt", label: "storyCanvas.editPrompt" }]
                            : []),
                          ...(node.type === "shot"
                            ? [
                                ...CANVAS_SHOT_FIELDS.map((kind) => ({
                                  kind,
                                  label: `storyCanvas.shot.${kind}`,
                                })),
                                { kind: "reorderShot", label: "storyCanvas.shot.reorder" },
                              ]
                            : []),
                          { kind: "remove", label: "storyCanvas.remove" },
                        ] as { kind: CanvasNodeEdit["kind"]; label: Parameters<typeof t>[0] }[]
                      ).map((action) => (
                        <Pressable
                          key={action.kind}
                          accessibilityRole="button"
                          onPress={() => setEdit({ nodeId: node.id, kind: action.kind })}
                          style={{ minHeight: 44, justifyContent: "center" }}
                        >
                          <ThemedText type="small">{t(action.label)}</ThemedText>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  {!!node.text && (
                    <ThemedText type="small" selectable>
                      {node.text}
                    </ThemedText>
                  )}
                </View>
              )
            )}
          {selected && tab === "nodes" && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setSelected(undefined)}
              style={{ padding: 10 }}
            >
              <ThemedText type="small">{t("platformCanvas.allCards")}</ThemedText>
            </Pressable>
          )}
        </ScrollView>
      )}
      {loaded && mediaNode && (
        <StoryCanvasMediaForm
          scope={scope}
          userId={userId}
          loaded={loaded}
          nodeId={mediaNode}
          canEdit={canEdit}
          close={saved}
          saved={saved}
        />
      )}
      {loaded && generationCard && canEdit && (
        <StoryCanvasGenerationPanel
          scope={scope}
          userId={userId}
          nodeId={generationCard.id}
          title={generationCard.title}
          close={saved}
        />
      )}
      {loaded && creating && canEdit && (
        <StoryCanvasCreateForm
          scope={scope}
          userId={userId}
          libraryAsset={libraryAsset}
          close={saved}
          saved={saved}
        />
      )}
      {loaded && panorama && (
        <StoryPanoramaPreview
          scope={scope}
          source={panorama}
          close={() => setPanorama(undefined)}
        />
      )}
      {loaded && positioning && canEdit && (
        <StoryCanvasPositionForm
          loaded={loaded}
          scope={scope}
          userId={userId}
          canEdit={canEdit}
          close={saved}
          saved={saved}
        />
      )}
      {loaded && grouping && (
        <StoryCanvasGroupForm
          loaded={loaded}
          scope={scope}
          userId={userId}
          canEdit={canEdit}
          close={saved}
          saved={saved}
        />
      )}
      {loaded && edit && canEdit && (
        <StoryCanvasEditForm
          scope={scope}
          userId={userId}
          loaded={loaded}
          edit={edit}
          close={saved}
          saved={saved}
        />
      )}
      {loaded && mediaPreview && (
        <StoryCanvasMediaPreview
          scope={scope}
          {...mediaPreview}
          close={() => setMediaPreview(undefined)}
        />
      )}
      {loaded && mapping && (
        <StoryCanvasMap
          storyboard={
            scope && (
              <CanvasStoryboard
                loaded={loaded}
                scope={scope}
                userId={userId}
                canEdit={canEdit}
                saved={saved}
              />
            )
          }
          generation={scope.generation}
          move={
            canEdit
              ? (edit, selection) => {
                  canvasPositionRecovery(scope, userId).stage(loaded.snapshot, edit, selection);
                  setMapping(false);
                  setPositioning(true);
                }
              : undefined
          }
          loaded={loaded}
          close={() => setMapping(false)}
          inspect={(nodeId) => {
            setSelected(nodeId);
            setTab("nodes");
            setMapping(false);
          }}
        />
      )}
    </>
  );
}
