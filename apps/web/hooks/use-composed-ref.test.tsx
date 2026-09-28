import { act, createRef, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useComposedRef } from "./use-composed-ref";
let root: Root, host: HTMLDivElement;
const internal = createRef<HTMLDivElement>();
function Probe({ userRef }: { userRef: Ref<HTMLDivElement> }) {
  return <div ref={useComposedRef(internal, userRef)}>menu</div>;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("runs callback cleanup and clears the internal ref on departure", async () => {
  const cleanup = vi.fn();
  const ref = vi.fn(() => cleanup);
  await act(async () => root.render(<Probe userRef={ref} />));
  const node = internal.current;
  expect(node?.textContent).toBe("menu");
  await act(async () => root.render(null));
  expect(cleanup).toHaveBeenCalledOnce();
  expect(ref).toHaveBeenCalledExactlyOnceWith(node);
  expect(internal.current).toBeNull();
});
it("cleans the previous callback before attaching its replacement", async () => {
  const events: string[] = [];
  const first = () => {
    events.push("first");
    return () => {
      events.push("cleanup first");
    };
  };
  const second = () => {
    events.push("second");
    return () => {
      events.push("cleanup second");
    };
  };
  await act(async () => root.render(<Probe userRef={first} />));
  await act(async () => root.render(<Probe userRef={second} />));
  expect(events).toEqual(["first", "cleanup first", "second"]);
  await act(async () => root.render(null));
  expect(events).toEqual(["first", "cleanup first", "second", "cleanup second"]);
});
it("retains object and legacy callback ref cleanup", async () => {
  const object = createRef<HTMLDivElement>();
  await act(async () => root.render(<Probe userRef={object} />));
  expect(object.current).toBe(internal.current);
  const legacy = vi.fn<(node: HTMLDivElement | null) => void>();
  await act(async () => root.render(<Probe userRef={legacy} />));
  expect(object.current).toBeNull();
  const node = internal.current;
  await act(async () => root.render(null));
  expect(legacy.mock.calls).toEqual([[node], [null]]);
  expect(internal.current).toBeNull();
});
