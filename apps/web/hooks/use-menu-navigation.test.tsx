import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMenuNavigation } from "./use-menu-navigation";
let root: Root, host: HTMLDivElement;
const select = vi.fn(),
  close = vi.fn();
function Menu({ items = ["one", "two"], auto = true }: { items?: string[]; auto?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { selectedIndex } = useMenuNavigation({
    containerRef: ref,
    items,
    onSelect: select,
    onClose: close,
    autoSelectFirstItem: auto,
  });
  return (
    <div ref={ref} data-selected={selectedIndex}>
      <input />
    </div>
  );
}
function key(key: string, isComposing = false) {
  const event = new KeyboardEvent("keydown", { key, isComposing, bubbles: true, cancelable: true });
  act(() => host.querySelector("input")!.dispatchEvent(event));
  return event;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  select.mockReset();
  close.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("leaves composition navigation and dismissal to the input method", async () => {
  await act(async () => root.render(<Menu />));
  for (const k of ["ArrowDown", "Escape", "Home", "Tab", "Enter"])
    expect(key(k, true).defaultPrevented).toBe(false);
  expect(host.firstElementChild?.getAttribute("data-selected")).toBe("0");
  expect(close).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});
it("allows dismissing an empty result list", async () => {
  await act(async () => root.render(<Menu items={[]} />));
  expect(key("Escape").defaultPrevented).toBe(true);
  expect(close).toHaveBeenCalledOnce();
});
it("keeps selection valid when asynchronously replaced results shrink", async () => {
  await act(async () => root.render(<Menu />));
  key("End");
  await act(async () => root.render(<Menu items={["remaining"]} />));
  key("Enter");
  expect(select).toHaveBeenCalledWith("remaining");
});
it("retains opt-out selection and normal navigation", async () => {
  await act(async () => root.render(<Menu auto={false} />));
  key("Enter");
  expect(select).not.toHaveBeenCalled();
  key("ArrowDown");
  key("Enter");
  expect(select).toHaveBeenCalledWith("one");
});
