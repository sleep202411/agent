import { storyboardPending } from "../lib/storyboard-pending";
import { IconLayoutGrid } from "@tabler/icons-react-native";
import { StoryboardSource } from "./canvas-storyboard-source";
import { useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
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
import { canvasAppendPosition } from "../lib/story-canvas-create-draft";
import { StoryboardMutation, type StoryboardEdit } from "./storyboard-mutation";
import { StoryboardThumbnail } from "./storyboard-thumbnail";
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
    theme = useTheme(),
    active = useScreenActive();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("storyboard.title")}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          minHeight: 44,
          alignSelf: "flex-start",
          padding: 12,
          borderRadius: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
        })}
      >
        <IconLayoutGrid size={20} color={theme.text} accessible={false} />
      </Pressable>
      {open && active && props.scope.generation === getAuthGeneration() && (
        <Timeline {...props} close={() => setOpen(false)} />
      )}
    </>
  );
}
function Timeline({
  loaded: initialLoaded,
  scope,
  userId,
  canEdit,
  saved,
  close,
}: Props & { close(): void }) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const [loaded, setLoaded] = useState(initialLoaded);
  const { width } = useWindowDimensions();
  const columns = width >= 1024 ? 6 : width >= 600 ? 3 : 2;
  const cellWidth = (width - insets.left - insets.right - 24 - (columns - 1) * 8) / columns;
  const [initializing, setInitializing] = useState(true);
  const [initial] = useState(() => {
    try {
      const create =
        canEdit &&
        (storyboardPending(scope, userId).read() ||
          canvasStoryboard(initialLoaded.snapshot).rows.length === 0);
      return {
        mutation: create
          ? {
              nodeId: uuid.v4(),
              type: "shot" as const,
              position: canvasAppendPosition(initialLoaded.snapshot),
            }
          : undefined,
        error: undefined,
      };
    } catch (e) {
      return { mutation: undefined, error: String(e) };
    }
  });
  const [mutation, setMutation] = useState<StoryboardEdit | undefined>(initial.mutation);
  const addShot = () => {
    setInitializing(false);
    setMutation({
      nodeId: uuid.v4(),
      type: "shot",
      position: canvasAppendPosition(loaded.snapshot),
    });
  };
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
  const [dragging, setDragging] = useState(false);
  const [dragMode, setDragMode] = useState(true),
    [chosen, setChosen] = useState<string>(),
    [hovered, setHovered] = useState<string>();
  const views = useRef(new Map<string, View>()),
    boxes = useRef(new Map<string, { x: number; y: number; width: number; height: number }>());
  const playbackRows = projection.value?.playbackRows ?? [];
  const index = Math.max(
      0,
      playbackRows.findIndex((r) => r.id === selected)
    ),
    shot = playbackRows[index];
  function attach(nodeId: string, sourceId: string) {
    if (!canEdit || mutation || scope.generation !== getAuthGeneration()) return;
    setPlaying(false);
    setMutation({ action: "attach", nodeId, sourceId, edgeId: uuid.v4() });
    setHovered(undefined);
  }
  const measure = () => {
    setDragging(true);
    boxes.current.clear();
    views.current.forEach((view, id) =>
      view.measureInWindow((x, y, width, height) => boxes.current.set(id, { x, y, width, height }))
    );
  };
  const target = (x: number, y: number) =>
    [...boxes.current].find(
      ([, b]) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height
    )?.[0];
  const select = (id: string) => {
    setSelected(id);
    setAutoPlay(playing);
  };
  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={() => {
        close();
        saved();
      }}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", padding: 12 }}>
          <ThemedText type="smallBold">{t("storyboard.title")}</ThemedText>
          <Pressable
            onPress={() => {
              close();
              saved();
            }}
          >
            <ThemedText>{t("agent.close")}</ThemedText>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }} scrollEnabled={!dragging}>
          {initial.error && <ThemedText accessibilityRole="alert">{initial.error}</ThemedText>}
          {projection.error && (
            <ThemedText accessibilityRole="alert">{projection.error}</ThemedText>
          )}
          {mutation && (
            <StoryboardMutation
              key={JSON.stringify(mutation)}
              scope={scope}
              userId={userId}
              edit={mutation}
              onlyIfEmpty={initializing && "type" in mutation}
              saved={(value) => {
                setInitializing(false);
                setLoaded(value);
                setMutation(undefined);
              }}
            />
          )}
          <View
            pointerEvents={mutation ? "none" : "auto"}
            style={{ gap: 12, opacity: mutation ? 0.5 : 1 }}
          >
            {canEdit && (
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Pressable
                  onPress={() => setDragMode((v) => !v)}
                  accessibilityState={{ selected: dragMode }}
                >
                  <ThemedText>{t("storyboard.drag")}</ThemedText>
                </Pressable>
                <Pressable onPress={addShot}>
                  <ThemedText>{t("storyboard.add")}</ThemedText>
                </Pressable>
              </View>
            )}
            {dragMode && canEdit && (
              <>
                <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
                  {sources.map((source) => (
                    <StoryboardSource
                      key={source.id}
                      source={source}
                      select={() => setChosen(source.id)}
                      start={() => {
                        setChosen(source.id);
                        measure();
                      }}
                      move={(x, y) => {
                        setHovered(target(x, y));
                        if (x < 0) setDragging(false);
                      }}
                      drop={(x, y) => {
                        setDragging(false);
                        const id = target(x, y);
                        if (id) attach(id, source.id);
                        setHovered(undefined);
                      }}
                    />
                  ))}
                </ScrollView>
              </>
            )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {rows.map((row, i) => (
                <View
                  key={row.id}
                  ref={(view) => {
                    if (view) views.current.set(row.id, view);
                    else views.current.delete(row.id);
                  }}
                  style={{
                    width: cellWidth,
                    gap: 6,
                    borderRadius: 8,
                    backgroundColor:
                      hovered === row.id ? theme.backgroundSelected : theme.backgroundElement,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <ThemedText type="small">
                      {t("storyboard.shotNumber").replace("{number}", String(i + 1))}
                    </ThemedText>
                    {canEdit && (
                      <Pressable
                        accessibilityLabel={t("storyboard.removeShot")}
                        style={{ padding: 12 }}
                        onPress={() => setMutation({ nodeId: row.id, kind: "remove", value: "" })}
                      >
                        <ThemedText>×</ThemedText>
                      </Pressable>
                    )}
                    {canEdit && (
                      <StoryboardSource
                        source={{ id: row.id, name: "⋮⋮", kind: "image", url: "" }}
                        compact
                        label={t("storyCanvas.shot.reorder")}
                        earlier={
                          i > 0
                            ? () =>
                                setMutation({
                                  nodeId: row.id,
                                  kind: "reorderShot",
                                  value: String(i),
                                })
                            : undefined
                        }
                        later={
                          i < rows.length - 1
                            ? () =>
                                setMutation({
                                  nodeId: row.id,
                                  kind: "reorderShot",
                                  value: String(i + 2),
                                })
                            : undefined
                        }
                        select={() => select(row.id)}
                        start={measure}
                        move={(x, y) => {
                          setHovered(target(x, y));
                          if (x < 0) setDragging(false);
                        }}
                        drop={(x, y) => {
                          setDragging(false);
                          const id = target(x, y);
                          if (id && id !== row.id)
                            setMutation({
                              nodeId: row.id,
                              kind: "reorderShot",
                              value: String(rows.findIndex((r) => r.id === id) + 1),
                            });
                          setHovered(undefined);
                        }}
                      />
                    )}
                  </View>
                  <Pressable
                    onPress={() => {
                      if (dragMode && chosen && canEdit) attach(row.id, chosen);
                      else select(row.id);
                    }}
                    accessibilityLabel={t("storyboard.shotNumber").replace(
                      "{number}",
                      String(i + 1)
                    )}
                  >
                    <StoryboardThumbnail media={row.media} scope={scope} />
                  </Pressable>
                </View>
              ))}
              {canEdit && (
                <Pressable
                  onPress={addShot}
                  style={{
                    width: cellWidth,
                    aspectRatio: 16 / 9,
                    marginTop: 44,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1,
                    borderStyle: "dashed",
                    borderRadius: 8,
                    borderColor: theme.border,
                  }}
                >
                  <ThemedText>+ {t("storyboard.newShot")}</ThemedText>
                </Pressable>
              )}
            </View>
            {shot && (
              <Pressable
                onPress={() => {
                  setPlaying((v) => !v);
                  setAutoPlay(true);
                }}
              >
                <ThemedText>{t(playing ? "storyboard.stop" : "storyboard.play")}</ThemedText>
              </Pressable>
            )}
            {playing &&
              !mutation &&
              (shot?.media ? (
                <CanvasStoryboardPlayer
                  key={`${shot.id}:${shot.media.url}`}
                  media={shot.media}
                  scope={scope}
                  autoPlay={autoPlay}
                  ended={() => {
                    if (playbackRows[index + 1]) {
                      setSelected(playbackRows[index + 1].id);
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
                disabled={!playbackRows.length}
              />
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
