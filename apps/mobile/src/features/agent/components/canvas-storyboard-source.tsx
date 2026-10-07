import { useLayoutEffect, useMemo, useRef } from "react";
import { PanResponder, Pressable } from "react-native";
import { ThemedText } from "@/components/themed-text";
import type { StoryboardMedia } from "../lib/canvas-storyboard";
export function StoryboardSource({
  source,
  select,
  start,
  move,
  drop,
}: {
  source: StoryboardMedia;
  select(): void;
  start(): void;
  move(x: number, y: number): void;
  drop(x: number, y: number): void;
}) {
  const callbacks = useRef({ select, start, move, drop });
  useLayoutEffect(() => {
    callbacks.current = { select, start, move, drop };
  }, [select, start, move, drop]);
  const responder = useMemo(
    () =>
      // PanResponder registers callbacks; it does not invoke them during render.
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
        onPanResponderGrant: () => callbacks.current.start(),
        onPanResponderMove: (_, g) => callbacks.current.move(g.moveX, g.moveY),
        onPanResponderRelease: (_, g) => {
          if (Math.hypot(g.dx, g.dy) < 6) callbacks.current.select();
          else callbacks.current.drop(g.moveX, g.moveY);
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderTerminate: () => callbacks.current.move(-1, -1),
      }),
    []
  );
  return (
    <Pressable
      onPress={select}
      {...responder.panHandlers}
      accessibilityRole="button"
      accessibilityLabel={source.name}
      accessibilityActions={[{ name: "activate" }]}
      onAccessibilityAction={select}
      style={{ width: 130, padding: 14, backgroundColor: "#222", borderRadius: 8 }}
    >
      <ThemedText numberOfLines={2}>{source.name}</ThemedText>
    </Pressable>
  );
}
