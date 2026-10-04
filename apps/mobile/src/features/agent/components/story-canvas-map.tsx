import type { CanvasPositionEdit } from "../../../../canvas-editor/position-schema";
import { useLayoutEffect, useMemo, useState } from "react";
import { Modal, PanResponder, Pressable, View, type GestureResponderEvent } from "react-native";
import Svg, { G, Path, Rect, Text as SvgText } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import {
  canvasLayout,
  fitCanvasCamera,
  panCanvasCamera,
  zoomCanvasCamera,
  type CanvasCamera,
} from "../lib/story-canvas-layout";
const groupColors = {
  slate: "#64748b",
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  green: "#22c55e",
  cyan: "#06b6d4",
  blue: "#3b82f6",
  indigo: "#6366f1",
  pink: "#ec4899",
};
function distance(event: GestureResponderEvent) {
  const [a, b] = event.nativeEvent.touches;
  return a && b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : 0;
}
function lines(text: string, width: number, maxLines = 3) {
  const chars = Array.from(text.replace(/\s+/g, " "));
  const count = Math.max(8, Math.floor((width - 32) / 18));
  return Array.from(
    { length: Math.min(maxLines, Math.ceil(chars.length / count)) },
    (_, i) =>
      chars.slice(i * count, (i + 1) * count).join("") +
      (i === maxLines - 1 && chars.length > count * maxLines ? "…" : "")
  );
}
export function StoryCanvasMap({
  loaded,
  close,
  inspect,
  move,
}: {
  loaded: CanvasLoaded;
  close(): void;
  inspect(nodeId: string): void;
  move?(edit: CanvasPositionEdit): void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const [moving, setMoving] = useState(false),
    [movementError, setMovementError] = useState<string>();
  const [drag, setDrag] = useState<{ nodeId: string; x: number; y: number }>();
  const projection = useMemo(() => {
    try {
      const snapshot = drag
        ? {
            ...loaded.snapshot,
            nodes: {
              ...loaded.snapshot.nodes,
              [drag.nodeId]: {
                ...(loaded.snapshot.nodes[drag.nodeId] as Record<string, unknown>),
                position: { x: drag.x, y: drag.y },
              },
            },
          }
        : loaded.snapshot;
      return { value: canvasLayout(snapshot) };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [loaded, drag]);
  const [viewport, setViewport] = useState({ width: 320, height: 480 });
  const [camera, setCamera] = useState<CanvasCamera | null>(null),
    [selected, setSelected] = useState<string>();
  const fitted = fitCanvasCamera(
    projection.value?.bounds ?? { x: 0, y: 0, width: 640, height: 480 },
    viewport
  );
  const visible = camera ?? fitted;
  const responder = useMemo(() => canvasPanResponder(setCamera), []);
  useLayoutEffect(() => {
    responder.updateCamera(visible);
  }, [responder, visible]);
  const node = projection.value?.nodes.find((node) => node.id === selected);
  const viewBox = `${visible.x - viewport.width / visible.scale / 2} ${visible.y - viewport.height / visible.scale / 2} ${viewport.width / visible.scale} ${viewport.height / visible.scale}`;
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          padding: 16,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
          gap: 12,
        }}
      >
        <View
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
        >
          <ThemedText type="smallBold">{t("storyCanvas.map.title")}</ThemedText>
          <MapAction label={t("agent.close")} onPress={close} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
          <MapAction label={t("storyCanvas.map.fit")} onPress={() => setCamera(null)} />
          <MapAction
            label={t("storyCanvas.map.zoomOut")}
            onPress={() => setCamera(zoomCanvasCamera(visible, 1 / 1.5))}
          />
          <MapAction
            label={t("storyCanvas.map.zoomIn")}
            onPress={() => setCamera(zoomCanvasCamera(visible, 1.5))}
          />
        </View>
        <ThemedText type="small">
          {t(moving ? "storyCanvas.map.moveHint" : "storyCanvas.map.hint")}
        </ThemedText>
        {movementError && (
          <ThemedText type="small" accessibilityRole="alert">
            {movementError}
          </ThemedText>
        )}
        {projection.error && (
          <ThemedText type="small" accessibilityRole="alert">
            {projection.error}
          </ThemedText>
        )}
        {projection.value?.nodes.length === 0 && (
          <ThemedText type="small">{t("storyCanvas.empty")}</ThemedText>
        )}
        <View
          {...responder.panHandlers}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            if (width > 0 && height > 0) setViewport({ width, height });
          }}
          style={{
            flex: 1,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 8,
          }}
        >
          <Svg width="100%" height="100%" viewBox={viewBox} pointerEvents="none" accessible={false}>
            {projection.value?.groups.map((group) => (
              <Rect
                key={group.id}
                x={group.x}
                y={group.y}
                width={group.width}
                height={group.height}
                rx={12}
                fill={groupColors[group.color]}
                fillOpacity={0.08}
                stroke={groupColors[group.color]}
                strokeOpacity={0.65}
                strokeWidth={1.5 / visible.scale}
              />
            ))}
            {projection.value?.edges.map((edge) => (
              <Path
                key={edge.id}
                d={edge.path}
                fill="none"
                stroke="#737373"
                strokeWidth={1.5 / visible.scale}
              />
            ))}
            {projection.value?.nodes.map((item) => (
              <G key={item.id}>
                <Rect
                  x={item.x}
                  y={item.y}
                  width={item.width}
                  height={item.height}
                  rx={8}
                  fill={theme.background}
                  stroke={item.id === selected ? theme.brand : "#525252"}
                  strokeWidth={(item.id === selected ? 2 : 1) / visible.scale}
                />
                {lines(item.title, item.width).map((line, index) => (
                  <SvgText
                    key={index}
                    x={item.x + 16}
                    y={item.y + 32 + index * 24}
                    fill="#eeeeee"
                    fontSize={18}
                    fontWeight="600"
                  >
                    {line}
                  </SvgText>
                ))}
                {lines(
                  item.text,
                  item.width,
                  Math.max(0, Math.min(3, Math.floor((item.height - 128) / 22) + 1))
                ).map((line, index) => (
                  <SvgText
                    key={`text:${index}`}
                    x={item.x + 16}
                    y={item.y + 112 + index * 22}
                    fill="#a3a3a3"
                    fontSize={16}
                  >
                    {line}
                  </SvgText>
                ))}
              </G>
            ))}
          </Svg>
          {projection.value?.nodes.map((item) => {
            const left = (item.x - visible.x) * visible.scale + viewport.width / 2;
            const top = (item.y - visible.y) * visible.scale + viewport.height / 2;
            const width = item.width * visible.scale,
              height = item.height * visible.scale;
            if (
              !(moving && selected === item.id) &&
              (left + width < 0 ||
                top + height < 0 ||
                left > viewport.width ||
                top > viewport.height)
            )
              return null;
            if (moving && selected === item.id && move)
              return (
                <DraggableNode
                  key={item.id}
                  node={item}
                  scale={visible.scale}
                  style={{ position: "absolute", left, top, width, height }}
                  preview={setDrag}
                  finish={(position) => {
                    setDrag(undefined);
                    setMoving(false);
                    if (!position) return;
                    try {
                      move({ action: "moveNodes", positions: [position] });
                    } catch (cause) {
                      setMovementError(cause instanceof Error ? cause.message : String(cause));
                    }
                  }}
                />
              );
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                accessibilityState={{ selected: selected === item.id }}
                onPress={() => {
                  setSelected(item.id);
                  setMoving(false);
                  setMovementError(undefined);
                }}
                style={{ position: "absolute", left, top, width, height }}
              />
            );
          })}
        </View>
        {node && (
          <View style={{ gap: 4 }}>
            <ThemedText type="smallBold">{node.title}</ThemedText>
            <ThemedText type="small" numberOfLines={2}>
              {node.text}
            </ThemedText>
            {move && (
              <MapAction
                label={t(moving ? "common.cancel" : "storyCanvas.map.moveNode")}
                onPress={() => {
                  setCamera(visible);
                  setMoving(!moving);
                  setMovementError(undefined);
                }}
              />
            )}
            <MapAction label={t("storyCanvas.map.inspect")} onPress={() => inspect(node.id)} />
          </View>
        )}
      </View>
    </Modal>
  );
}
function MapAction({ label, onPress }: { label: string; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ paddingVertical: 10 }}>
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}

function canvasPanResponder(onChange: (camera: CanvasCamera) => void) {
  let current: CanvasCamera = { x: 0, y: 0, scale: 1 };
  let origin = current,
    pinch = 0;
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) =>
      gesture.numberActiveTouches > 1 || Math.abs(gesture.dx) + Math.abs(gesture.dy) > 5,
    onPanResponderGrant: (event) => {
      origin = current;
      pinch = distance(event);
    },
    onPanResponderMove: (event, gesture) => {
      const span = distance(event);
      onChange(
        span > 0 && pinch > 0
          ? zoomCanvasCamera(origin, span / pinch)
          : panCanvasCamera(origin, gesture.dx, gesture.dy)
      );
    },
    onPanResponderTerminationRequest: () => true,
    onPanResponderRelease: () => {
      pinch = 0;
    },
    onPanResponderTerminate: () => {
      pinch = 0;
    },
  });
  return {
    ...responder,
    updateCamera: (camera: CanvasCamera) => {
      current = camera;
    },
  };
}

type DragPosition = { nodeId: string; x: number; y: number };
type DragConfig = {
  node: { id: string; x: number; y: number; title: string };
  scale: number;
  preview(position: DragPosition | undefined): void;
  finish(position?: DragPosition): void;
};
function DraggableNode({
  style,
  ...config
}: DragConfig & { style: import("react-native").ViewStyle }) {
  const responder = useMemo(() => nodeDragResponder(), []);
  useLayoutEffect(() => responder.update(config), [responder, config]);
  return (
    <View
      {...responder.panHandlers}
      style={style}
      accessible
      accessibilityLabel={config.node.title}
    />
  );
}
function nodeDragResponder() {
  let config: DragConfig | undefined;
  let origin: DragPosition | undefined,
    scale = 1,
    cancelled = false;
  const result = (dx: number, dy: number) => {
    if (!origin || cancelled) return undefined;
    const x = origin.x + dx / scale,
      y = origin.y + dy / scale;
    return Number.isFinite(x) && Number.isFinite(y) ? { ...origin, x, y } : undefined;
  };
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      if (!config) return;
      origin = { nodeId: config.node.id, x: config.node.x, y: config.node.y };
      scale = config.scale;
      cancelled = false;
    },
    onPanResponderMove: (_event, gesture) => {
      if (gesture.numberActiveTouches > 1) cancelled = true;
      config?.preview(result(gesture.dx, gesture.dy));
    },
    onPanResponderRelease: (_event, gesture) => {
      const next = result(gesture.dx, gesture.dy);
      config?.finish(
        next && origin && (next.x !== origin.x || next.y !== origin.y) ? next : undefined
      );
      origin = undefined;
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: () => {
      config?.preview(undefined);
      config?.finish();
      origin = undefined;
    },
  });
  return {
    ...responder,
    update: (next: DragConfig) => {
      config = next;
    },
  };
}
