// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { STORYBOARD_COLUMNS, cellDomId } from "./storyboard-columns";
import type { StoryboardCellProps } from "./storyboard-types";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./shot-number-cell", () => ({ ShotNumberCell: () => null }));
vi.mock("./shot-picture-cell", () => ({ ShotPictureCell: () => null }));
vi.mock("./shot-meta-cells", () => ({ ShotIdCell: () => null, ShotMenuCell: () => null }));
vi.mock("./shot-prompt-cell", () => ({ ShotPromptCell: () => null }));
let root: Root, host: HTMLDivElement;
const navigate = vi.fn(),
  patch = vi.fn();
function key(target: Element, value: string) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  act(() => target.dispatchEvent(event));
  return event;
}
async function mount(column: string) {
  const Cell = STORYBOARD_COLUMNS.find((c) => c.key === column)!.Cell;
  const props = {
    row: { id: "shot-a", data: { durationSeconds: 12, dialogue: "Before", notes: "Before" } },
    index: 0,
    rowCount: 2,
    canEdit: true,
    selected: false,
    label: column,
    handle: {},
    actions: { onPatch: patch },
    cellId: cellDomId("shot-a", column),
    onNavigate: navigate,
  } as unknown as StoryboardCellProps;
  await act(async () => root.render(<Cell {...props} />));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  navigate.mockClear();
  patch.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
});
it.each(["size", "angle", "movement", "duration", "dialogue", "notes"])(
  "wires the %s column into row focus/navigation",
  async (column) => {
    await mount(column);
    const target = document.getElementById(cellDomId("shot-a", column));
    expect(target).not.toBeNull();
    expect(key(target!, "Tab").defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith("next");
  }
);
it.each(["duration", "dialogue", "notes"])(
  "commits and navigates Enter through the %s adapter",
  async (column) => {
    await mount(column);
    key(host.querySelector('[role="button"]')!, "5");
    const input = host.querySelector("input,textarea")!;
    expect(key(input, "Enter").defaultPrevented).toBe(true);
    expect(patch).toHaveBeenCalledWith("shot-a", {
      [column === "duration" ? "durationSeconds" : column]: column === "duration" ? 5 : "5",
    });
    expect(navigate).toHaveBeenCalledWith("down");
    expect(host.querySelector("input,textarea")).toBeNull();
  }
);
