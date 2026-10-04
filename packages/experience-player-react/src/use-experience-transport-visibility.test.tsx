// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExperienceTransportVisibility } from "./use-experience-transport-visibility";

function Harness({ available = true, paused = false }: { available?: boolean; paused?: boolean }) {
  const controls = useExperienceTransportVisibility({ available, paused });
  return (
    <>
      <div
        data-testid="activity"
        onPointerMove={controls.onPointerMove}
        onPointerDown={controls.onPointerDown}
        onKeyDownCapture={controls.onKeyDownCapture}
      >
        <div
          data-testid="controls"
          data-visible={controls.visible}
          onFocusCapture={controls.onFocusCapture}
          onBlurCapture={controls.onBlurCapture}
          onPointerEnter={controls.onPointerEnter}
          onPointerLeave={controls.onPointerLeave}
        >
          <button type="button" onClick={() => consumed(controls.consumeWakeTap())}>
            Action
          </button>
          <input aria-label="Progress" />
        </div>
      </div>
      <button type="button" data-testid="outside">
        Outside
      </button>
    </>
  );
}
const consumed = vi.fn<(value: boolean) => void>();

describe("playback controls activity visibility", () => {
  let container: HTMLDivElement;
  let root: Root;
  const activity = () => container.querySelector<HTMLElement>('[data-testid="activity"]')!;
  const controls = () => container.querySelector<HTMLElement>('[data-testid="controls"]')!;
  const action = () => controls().querySelector<HTMLButtonElement>("button")!;
  const visible = () => controls().getAttribute("data-visible") === "true";
  const render = (props: Parameters<typeof Harness>[0] = {}) => {
    act(() => root.render(<Harness {...props} />));
  };
  const tick = (milliseconds: number) => {
    act(() => vi.advanceTimersByTime(milliseconds));
  };
  const pointer = (
    type: string,
    pointerType: "mouse" | "touch",
    target = activity(),
    relatedTarget: EventTarget | null = null
  ) => {
    const event = new MouseEvent(type, { bubbles: true, relatedTarget });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    act(() => target.dispatchEvent(event));
  };
  const click = () => act(() => action().click());
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    consumed.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("hides after three idle seconds and does not extend that deadline on player rerenders", () => {
    render();
    expect(visible()).toBe(true);
    tick(2000);
    render();
    tick(999);
    expect(visible()).toBe(true);
    tick(1);
    expect(visible()).toBe(false);
    render();
    expect(visible()).toBe(false);
    expect(controls().isConnected).toBe(true);
  });

  it("reveals on pointer movement or keyboard activity and renews the user activity deadline", () => {
    render();
    tick(3000);
    expect(visible()).toBe(false);
    pointer("pointermove", "mouse");
    expect(visible()).toBe(true);
    tick(2500);
    pointer("pointermove", "mouse");
    tick(1000);
    expect(visible()).toBe(true);
    tick(2000);
    expect(visible()).toBe(false);
    act(() =>
      activity().dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))
    );
    expect(visible()).toBe(true);
    tick(3000);
    expect(visible()).toBe(false);
  });

  it("consumes only the first touch tap that wakes hidden controls", () => {
    render();
    tick(3000);
    pointer("pointerdown", "touch");
    expect(visible()).toBe(true);
    click();
    expect(consumed).toHaveBeenLastCalledWith(true);
    click();
    expect(consumed).toHaveBeenLastCalledWith(false);
    pointer("pointerdown", "touch");
    click();
    expect(consumed).toHaveBeenLastCalledWith(false);
    tick(3000);
    pointer("pointerdown", "mouse");
    click();
    expect(visible()).toBe(true);
    expect(consumed).toHaveBeenLastCalledWith(false);
  });

  it("ignores touch movement and touch hover instead of pinning controls visible during a gesture", () => {
    render();
    tick(3000);
    pointer("pointermove", "touch");
    pointer("pointerover", "touch", controls());
    expect(visible()).toBe(false);
    pointer("pointerdown", "touch");
    expect(visible()).toBe(true);
    tick(3000);
    expect(visible()).toBe(false);
  });

  it("reveals when keyboard focus reaches a faded control and stays visible across internal focus changes", () => {
    render();
    tick(3000);
    expect(visible()).toBe(false);
    act(() => action().focus());
    expect(visible()).toBe(true);
    tick(5000);
    expect(visible()).toBe(true);
    act(() => controls().querySelector<HTMLInputElement>("input")!.focus());
    tick(5000);
    expect(visible()).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="outside"]')!.focus());
    tick(2999);
    expect(visible()).toBe(true);
    tick(1);
    expect(visible()).toBe(false);
  });

  it("keeps controls under the mouse until it leaves, then gives another three seconds", () => {
    render();
    tick(3000);
    pointer("pointerover", "mouse", controls());
    expect(visible()).toBe(true);
    tick(5000);
    expect(visible()).toBe(true);
    pointer("pointerout", "mouse", controls(), document.body);
    tick(2999);
    expect(visible()).toBe(true);
    tick(1);
    expect(visible()).toBe(false);
  });

  it("keeps a paused player's controls visible but hides them when interactions make them unavailable", () => {
    render();
    tick(3000);
    expect(visible()).toBe(false);
    render({ paused: true });
    expect(visible()).toBe(true);
    tick(10000);
    expect(visible()).toBe(true);
    render({ paused: true, available: false });
    expect(visible()).toBe(false);
    pointer("pointerdown", "touch");
    click();
    expect(visible()).toBe(false);
    expect(consumed).toHaveBeenLastCalledWith(false);
    render({ paused: false, available: true });
    expect(visible()).toBe(true);
    tick(3000);
    expect(visible()).toBe(false);
  });

  it("clears the idle timer when its player unmounts", () => {
    render();
    expect(vi.getTimerCount()).toBe(1);
    act(() => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
    tick(5000);
  });
});
