import { useMemo, useRef, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { ThemedText } from "@/components/themed-text";
import tokens from "@/config/theme-tokens.json";
import type { ExperienceJourneyMapGraph } from "../lib/experience-journey-model";

export interface ExperienceJourneyMapCopy {
  open: string;
  title: string;
  description: string;
  close: string;
  current: string;
  explored: string;
  unexplored: string;
  unexploredHint: string;
  replay: string;
  replaying: string;
  replayHint: string;
  replayUnavailable: string;
  empty: string;
  canvasLabel: string;
  centerCurrent: string;
  endingLabel: string;
  truncated: string;
  zoomIn: string;
  zoomOut: string;
  sceneLabel: (number: number) => string;
}

/** Stable breadth-first layout, including disconnected and cyclic branches. */
export function layoutJourneyGraph(graph: ExperienceJourneyMapGraph) {
  const ids = new Set(graph.nodes.map((node) => node.sceneId));
  const incoming = new Set(graph.edges.map((edge) => edge.toSceneId));
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!ids.has(edge.fromSceneId) || !ids.has(edge.toSceneId)) continue;
    outgoing.set(edge.fromSceneId, [...(outgoing.get(edge.fromSceneId) ?? []), edge.toSceneId]);
  }
  const depths = new Map<string, number>();
  const walk = (root: string) => {
    if (depths.has(root)) return;
    depths.set(root, 0);
    const queue = [root];
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index]!;
      for (const target of outgoing.get(id) ?? []) {
        if (depths.has(target)) continue;
        depths.set(target, depths.get(id)! + 1);
        queue.push(target);
      }
    }
  };
  graph.nodes.filter((node) => !incoming.has(node.sceneId)).forEach((node) => walk(node.sceneId));
  graph.nodes.forEach((node) => walk(node.sceneId));
  const rows = new Map<number, number>();
  return new Map(
    graph.nodes.map((node) => {
      const depth = depths.get(node.sceneId)!;
      const row = rows.get(depth) ?? 0;
      rows.set(depth, row + 1);
      return [node.sceneId, { x: 16 + depth * 216, y: 16 + row * 120 }];
    })
  );
}

export function ExperienceJourneyMap({
  graph,
  currentSceneId,
  nodeDetails,
  copy,
  onClose,
  onReplay,
  replayPending = false,
  error,
}: {
  graph: ExperienceJourneyMapGraph;
  currentSceneId: string;
  nodeDetails?: Readonly<Record<string, { title?: string; thumbnailUrl?: string }>>;
  copy: ExperienceJourneyMapCopy;
  onClose: () => void;
  onReplay: (sceneId: string) => void;
  replayPending?: boolean;
  error?: string;
}) {
  const positions = useMemo(() => layoutJourneyGraph(graph), [graph]);
  const [zoom, setZoom] = useState(1);
  const [hint, setHint] = useState<string>();
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(new Set());
  const horizontal = useRef<ScrollView>(null);
  const vertical = useRef<ScrollView>(null);
  const width = Math.max(300, ...[...positions.values()].map((p) => p.x + 200)) * zoom;
  const height = Math.max(200, ...[...positions.values()].map((p) => p.y + 112)) * zoom;
  const locate = () => {
    const point = positions.get(currentSceneId);
    if (!point) return;
    horizontal.current?.scrollTo({ x: Math.max(0, point.x * zoom - 16), animated: true });
    vertical.current?.scrollTo({ y: Math.max(0, point.y * zoom - 16), animated: true });
  };
  return (
    <Modal
      visible
      animationType="fade"
      onRequestClose={() => {
        if (!replayPending) onClose();
      }}
    >
      <SafeAreaView style={styles.host}>
        <View style={styles.header}>
          <ThemedText type="smallBold" style={styles.title}>
            {copy.title}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.close}
            disabled={replayPending}
            onPress={onClose}
            style={styles.button}
          >
            <ThemedText style={styles.text}>{copy.close}</ThemedText>
          </Pressable>
        </View>
        <ThemedText type="small" style={styles.description}>
          {copy.description}
        </ThemedText>
        <View style={styles.toolbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.zoomOut}
            disabled={zoom <= 0.75}
            onPress={() => setZoom((value) => Math.max(0.75, value - 0.25))}
            style={styles.button}
          >
            <ThemedText style={styles.text}>−</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.zoomIn}
            disabled={zoom >= 1.5}
            onPress={() => setZoom((value) => Math.min(1.5, value + 0.25))}
            style={styles.button}
          >
            <ThemedText style={styles.text}>+</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!positions.has(currentSceneId)}
            onPress={locate}
            style={styles.button}
          >
            <ThemedText type="small" style={styles.text}>
              {copy.centerCurrent}
            </ThemedText>
          </Pressable>
        </View>
        {graph.nodes.length ? (
          <ScrollView ref={vertical} style={styles.scroll} nestedScrollEnabled>
            <ScrollView
              ref={horizontal}
              horizontal
              nestedScrollEnabled
              accessibilityLabel={copy.canvasLabel}
            >
              <View style={{ width, height }}>
                <Svg
                  width={width}
                  height={height}
                  style={StyleSheet.absoluteFill}
                  accessibilityElementsHidden
                >
                  {graph.edges.map((edge) => {
                    const from = positions.get(edge.fromSceneId),
                      to = positions.get(edge.toSceneId);
                    if (!from || !to) return null;
                    const x1 = (from.x + 176) * zoom,
                      y1 = (from.y + 44) * zoom;
                    const x2 = to.x * zoom,
                      y2 = (to.y + 44) * zoom;
                    return (
                      <Path
                        key={edge.edgeId}
                        d={`M ${x1} ${y1} C ${x1 + 24 * zoom} ${y1}, ${x2 - 24 * zoom} ${y2}, ${x2} ${y2}`}
                        stroke={edge.traversed ? tokens.colors.brand[500] : "#555555"}
                        strokeWidth={edge.traversed ? 2 : 1}
                        strokeDasharray={edge.traversed ? undefined : "4 4"}
                        fill="none"
                      />
                    );
                  })}
                </Svg>
                {graph.nodes.map((node, index) => {
                  const p = positions.get(node.sceneId)!;
                  const details = node.visited ? nodeDetails?.[node.sceneId] : undefined;
                  const title = !node.visited
                    ? copy.unexplored
                    : (details?.title ??
                      (node.kind === "ending" ? copy.endingLabel : copy.sceneLabel(index + 1)));
                  const replayable = node.visited && node.replayable && node.kind === "scene";
                  return (
                    <Pressable
                      key={node.sceneId}
                      accessibilityRole="button"
                      accessibilityLabel={replayable ? `${copy.replay}: ${title}` : title}
                      accessibilityHint={
                        replayable
                          ? copy.replayHint
                          : node.visited
                            ? copy.replayUnavailable
                            : copy.unexploredHint
                      }
                      accessibilityState={{
                        disabled: replayPending,
                        selected: currentSceneId === node.sceneId,
                      }}
                      disabled={replayPending}
                      onPress={() =>
                        replayable
                          ? onReplay(node.sceneId)
                          : setHint(node.visited ? copy.replayUnavailable : copy.unexploredHint)
                      }
                      style={[
                        styles.node,
                        currentSceneId === node.sceneId && styles.current,
                        {
                          left: p.x * zoom,
                          top: p.y * zoom,
                          width: 176 * zoom,
                          minHeight: 88 * zoom,
                        },
                      ]}
                    >
                      {details?.thumbnailUrl && !failedImages.has(details.thumbnailUrl) ? (
                        <Image
                          source={{ uri: details.thumbnailUrl }}
                          accessible={false}
                          style={styles.thumbnail}
                          onError={() =>
                            setFailedImages((old) => new Set([...old, details.thumbnailUrl!]))
                          }
                        />
                      ) : null}
                      <ThemedText numberOfLines={2} type="smallBold" style={styles.text}>
                        {title}
                      </ThemedText>
                      <ThemedText numberOfLines={1} type="small" style={styles.muted}>
                        {currentSceneId === node.sceneId
                          ? copy.current
                          : node.visited
                            ? copy.explored
                            : "?"}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </ScrollView>
        ) : (
          <ThemedText style={styles.description}>{copy.empty}</ThemedText>
        )}
        <View style={styles.footer}>
          {error ? (
            <ThemedText accessibilityRole="alert" style={styles.text}>
              {error}
            </ThemedText>
          ) : null}
          <ThemedText type="small" accessibilityLiveRegion="polite" style={styles.muted}>
            {replayPending ? copy.replaying : (hint ?? copy.replayHint)}
          </ThemedText>
          {graph.truncated ? (
            <ThemedText type="small" style={styles.muted}>
              {copy.truncated}
            </ThemedText>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// Use the existing player's native StyleSheet path and shared tokens (see published player).
const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: "#090909" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8 },
  title: { flex: 1, color: "#FFFFFF" },
  text: { color: "#FFFFFF", fontSize: 14 },
  muted: { color: "#AAAAAA", fontSize: 12 },
  description: { color: "#AAAAAA", paddingHorizontal: 12, paddingBottom: 8 },
  toolbar: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  button: {
    minHeight: 44,
    minWidth: 44,
    padding: 8,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: tokens.colors.dark.surface,
  },
  scroll: { flex: 1 },
  node: {
    position: "absolute",
    padding: 10,
    gap: 6,
    backgroundColor: tokens.colors.dark.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#555555",
  },
  thumbnail: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.25,
    borderRadius: 8,
  },
  current: { borderColor: tokens.colors.brand[500], borderWidth: 2 },
  footer: { padding: 12, gap: 8 },
});
