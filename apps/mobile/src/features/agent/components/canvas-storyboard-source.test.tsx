import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { StoryboardSource } from "./canvas-storyboard-source";
const h = vi.hoisted(() => ({
  handlers: {} as Record<string, (...args: any[]) => unknown>,
  creates: 0,
}));
vi.mock("react-native", () => ({
  PanResponder: {
    create: (handlers: typeof h.handlers) => {
      h.handlers = handlers;
      h.creates++;
      return { panHandlers: {} };
    },
  },
  Pressable: ({ children, onPress }: { children: ReactNode; onPress(): void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
it("keeps a drag alive through hover renders and drops on the current handler", async () => {
  const root = createRoot(document.createElement("div")),
    start = vi.fn(),
    move = vi.fn(),
    drop = vi.fn(),
    select = vi.fn();
  h.creates = 0;
  const media = {
    id: "image",
    name: "Image",
    kind: "image" as const,
    url: "https://media.test/image.png",
  };
  const render = (onDrop = drop) =>
    act(async () =>
      root.render(
        <StoryboardSource source={media} start={start} move={move} drop={onDrop} select={select} />
      )
    );
  try {
    await render();
    expect(h.handlers.onStartShouldSetPanResponder()).toBe(false);
    expect(h.handlers.onMoveShouldSetPanResponder(null, { dx: 0, dy: 2 })).toBe(false);
    expect(h.handlers.onMoveShouldSetPanResponder(null, { dx: 0, dy: 30 })).toBe(true);
    h.handlers.onPanResponderGrant();
    expect(start).toHaveBeenCalled();
    const latest = vi.fn();
    await render(latest);
    expect(h.creates).toBe(1);
    h.handlers.onPanResponderMove(null, { moveX: 80, moveY: 200 });
    expect(move).toHaveBeenCalledWith(80, 200);
    h.handlers.onPanResponderRelease(null, { dx: 80, dy: 200, moveX: 80, moveY: 200 });
    expect(latest).toHaveBeenCalledWith(80, 200);
    expect(drop).not.toHaveBeenCalled();
    h.handlers.onPanResponderTerminate();
    expect(move).toHaveBeenLastCalledWith(-1, -1);
  } finally {
    await act(async () => root.unmount());
  }
});
