export interface StoryNodeCreationPoint {
  x: number;
  y: number;
}

export type StoryNodeCreationKind = "root" | "clip" | "router" | "ending";

export interface StoryNodeCreationMenuPlacement {
  left: number;
  top: number;
  flowPosition: StoryNodeCreationPoint;
}

const MENU_MARGIN = 12;
const MENU_WIDTH = 310;
const MENU_HEIGHT = 280;
const MENU_HEIGHT_WITH_STORY_WORLD = 348;
const DOCK_NUDGE_STEP = 26;
const DOCK_NUDGE_CYCLE = 6;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function resolveStoryNodeCreationMenuPlacement({
  clientPosition,
  container,
  flowPosition,
  showStoryWorld,
}: {
  clientPosition: StoryNodeCreationPoint;
  container: { left: number; top: number; width: number; height: number };
  flowPosition: StoryNodeCreationPoint;
  showStoryWorld: boolean;
}): StoryNodeCreationMenuPlacement {
  const localX = clientPosition.x - container.left;
  const localY = clientPosition.y - container.top;
  const menuHeight = showStoryWorld ? MENU_HEIGHT_WITH_STORY_WORLD : MENU_HEIGHT;

  return {
    left: clamp(localX, MENU_MARGIN, container.width - MENU_WIDTH - MENU_MARGIN),
    top: clamp(localY, MENU_MARGIN, container.height - menuHeight - MENU_MARGIN),
    // The menu may be clamped to stay visible, but the node must still land at
    // the original canvas point selected by the creator.
    flowPosition: { ...flowPosition },
  };
}

export function offsetStoryNodeDockCreationPosition(
  center: StoryNodeCreationPoint,
  nodeCount: number
): StoryNodeCreationPoint {
  const nudge = (Math.max(0, nodeCount) % DOCK_NUDGE_CYCLE) * DOCK_NUDGE_STEP;
  return { x: center.x + nudge, y: center.y + nudge };
}
