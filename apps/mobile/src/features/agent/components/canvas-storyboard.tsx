import { StoryboardSource } from "./canvas-storyboard-source";
import { useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { uuid } from "expo-modules-core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import type { CanvasEditScope } from "../lib/story-canvas-draft";
import { canvasStoryboard } from "../lib/canvas-storyboard";
import { canvasMediaBaseline, canvasMediaDraftStore } from "../lib/story-canvas-media-draft";
import { StoryCanvasMediaForm } from "./story-canvas-media-form";
import { StoryCanvasEditForm } from "./story-canvas-edit-form";
import { StoryCanvasCreateForm } from "./story-canvas-create-form";
import { CanvasStoryboardPlayer } from "./canvas-storyboard-player";
import { CanvasStoryboardExport } from "./canvas-storyboard-export";
type Props = {
  loaded: CanvasLoaded;
  scope: CanvasEditScope;
  userId: string;
  canEdit: boolean;
  saved(): void;
};
export function CanvasStoryboard(props: Props) {
  const t = useTranslations(),
    active = useScreenActive();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={{ padding: 12 }}>
        <ThemedText>{t("storyboard.title")}</ThemedText>
      </Pressable>
      {open && active && props.scope.generation === getAuthGeneration() && (
        <Timeline {...props} close={() => setOpen(false)} />
      )}
    </>
  );
}
function Timeline({ loaded, scope, userId, canEdit, saved, close }: Props & { close(): void }) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const projection = useMemo(() => {
    try {
      return { value: canvasStoryboard(loaded.snapshot) };
    } catch (e) {
      return { error: String(e) };
    }
  }, [loaded]);
  const rows = projection.value?.rows ?? [],
    sources = projection.value?.sources ?? [];
  const [selected, setSelected] = useState(rows[0]?.id),
    [autoPlay, setAutoPlay] = useState(false),
    [playing, setPlaying] = useState(false);
  const [dragMode, setDragMode] = useState(false),
    [chosen, setChosen] = useState<string>(),
    [hovered, setHovered] = useState<string>();
  const [editing, setEditing] = useState<string>(),
    [reorder, setReorder] = useState<string>(),
    [creating, setCreating] = useState(false),
    [error, setError] = useState<string>();
  const views = useRef(new Map<string, View>()),
    boxes = useRef(new Map<string, { x: number; y: number; width: number; height: number }>());
  const index = Math.max(
      0,
      rows.findIndex((r) => r.id === selected)
    ),
    shot = rows[index];
  const finished = () => {
    close();
    saved();
  };
  function attach(nodeId: string, sourceId: string) {
    if (!canEdit || scope.generation !== getAuthGeneration()) return;
    try {
      const store = canvasMediaDraftStore(scope, userId);
      if (store.read()) throw Error(t("storyboard.pending"));
      const edit = { action: "attach" as const, nodeId, sourceId, edgeId: uuid.v4() };
      store.write({
        edit,
        title: sources.find((s) => s.id === sourceId)?.name ?? sourceId,
        baseline: canvasMediaBaseline(loaded.snapshot, edit),
      });
      setPlaying(false);
      setEditing(nodeId);
      setHovered(undefined);
    } catch (e) {
      setError(String(e));
    }
  }
  const target = (x: number, y: number) =>
    [...boxes.current].find(
      ([, b]) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height
    )?.[0];
  const select = (id: string) => {
    setSelected(id);
    setAutoPlay(false);
  };
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
        <View style={{ flexDirection: "row", justifyContent: "space-between", padding: 12 }}>
          <ThemedText type="smallBold">{t("storyboard.title")}</ThemedText>
          <Pressable onPress={close}>
            <ThemedText>{t("agent.close")}</ThemedText>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }} scrollEnabled={!dragMode}>
          {(error || projection.error) && (
            <ThemedText accessibilityRole="alert">{error || projection.error}</ThemedText>
          )}
          {canEdit && (
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Pressable
                onPress={() => setDragMode((v) => !v)}
                accessibilityState={{ selected: dragMode }}
              >
                <ThemedText>{t("storyboard.drag")}</ThemedText>
              </Pressable>
              <Pressable onPress={() => setCreating(true)}>
                <ThemedText>{t("storyboard.add")}</ThemedText>
              </Pressable>
            </View>
          )}
          {dragMode && canEdit && (
            <>
              <ThemedText type="small">{t("storyboard.dragHelp")}</ThemedText>
              <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
                {sources.map((source) => (
                  <StoryboardSource
                    key={source.id}
                    source={source}
                    select={() => setChosen(source.id)}
                    start={() => {
                      setChosen(source.id);
                      boxes.current.clear();
                      views.current.forEach((view, id) =>
                        view.measureInWindow((x, y, width, height) =>
                          boxes.current.set(id, { x, y, width, height })
                        )
                      );
                    }}
                    move={(x, y) => setHovered(target(x, y))}
                    drop={(x, y) => {
                      const id = target(x, y);
                      if (id) attach(id, source.id);
                      setHovered(undefined);
                    }}
                  />
                ))}
              </ScrollView>
            </>
          )}
          {!rows.length && <ThemedText>{t("storyboard.empty")}</ThemedText>}
          <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
            {rows.map((row, i) => (
              <View
                key={row.id}
                ref={(view) => {
                  if (view) views.current.set(row.id, view);
                  else views.current.delete(row.id);
                }}
                style={{
                  width: 145,
                  padding: 12,
                  gap: 8,
                  borderWidth: 1,
                  borderColor: hovered === row.id || shot?.id === row.id ? "#E52227" : "#444",
                  borderRadius: 8,
                }}
              >
                <Pressable onPress={() => select(row.id)}>
                  <ThemedText type="smallBold">
                    {i + 1}. {row.title}
                  </ThemedText>
                  <ThemedText type="small">
                    {row.media ? t(`storyboard.${row.media.kind}`) : t("storyboard.missing")}
                  </ThemedText>
                </Pressable>
                {canEdit && (
                  <>
                    <Pressable
                      onPress={() => {
                        setPlaying(false);
                        setEditing(row.id);
                      }}
                    >
                      <ThemedText type="small">{t("storyCanvas.media.title")}</ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setPlaying(false);
                        setReorder(row.id);
                      }}
                    >
                      <ThemedText type="small">{t("storyCanvas.shot.reorder")}</ThemedText>
                    </Pressable>
                    {dragMode && chosen && (
                      <Pressable onPress={() => attach(row.id, chosen)}>
                        <ThemedText type="small">{t("storyboard.place")}</ThemedText>
                      </Pressable>
                    )}
                  </>
                )}
              </View>
            ))}
          </ScrollView>
          {shot && (
            <Pressable
              onPress={() => {
                setPlaying((v) => !v);
                setAutoPlay(false);
              }}
            >
              <ThemedText>{t(playing ? "storyboard.stop" : "storyboard.play")}</ThemedText>
            </Pressable>
          )}
          {playing &&
            !editing &&
            !reorder &&
            !creating &&
            (shot?.media ? (
              <CanvasStoryboardPlayer
                key={`${shot.id}:${shot.media.url}`}
                media={shot.media}
                scope={scope}
                autoPlay={autoPlay}
                ended={() => {
                  if (rows[index + 1]) {
                    setSelected(rows[index + 1].id);
                    setAutoPlay(true);
                  } else setPlaying(false);
                }}
              />
            ) : (
              <ThemedText>{t("storyboard.missing")}</ThemedText>
            ))}
          {"kind" in scope && scope.kind === "platform" && (
            <CanvasStoryboardExport
              scope={scope}
              userId={userId}
              sequence={loaded.sequence}
              disabled={!rows.length}
            />
          )}
        </ScrollView>
        {editing && (
          <StoryCanvasMediaForm
            scope={scope}
            userId={userId}
            loaded={loaded}
            nodeId={editing}
            canEdit={canEdit}
            close={() => setEditing(undefined)}
            saved={finished}
          />
        )}
        {reorder && canEdit && (
          <StoryCanvasEditForm
            scope={scope}
            userId={userId}
            loaded={loaded}
            edit={{ nodeId: reorder, kind: "reorderShot" }}
            close={() => setReorder(undefined)}
            saved={finished}
          />
        )}
        {creating && canEdit && (
          <StoryCanvasCreateForm
            scope={scope}
            userId={userId}
            initialType="shot"
            close={() => setCreating(false)}
            saved={finished}
          />
        )}
      </View>
    </Modal>
  );
}
