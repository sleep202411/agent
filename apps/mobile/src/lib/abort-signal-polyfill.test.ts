import { afterEach, expect, it, vi } from "vitest";
import {
  AbortController as NativeAbortController,
  AbortSignal as NativeAbortSignal,
} from "abort-controller";

const original = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "throwIfAborted");

afterEach(() => {
  vi.unstubAllGlobals();
  if (original) Object.defineProperty(AbortSignal.prototype, "throwIfAborted", original);
  else Reflect.deleteProperty(AbortSignal.prototype, "throwIfAborted");
  vi.resetModules();
});

async function install() {
  Reflect.deleteProperty(AbortSignal.prototype, "throwIfAborted");
  await import("./abort-signal-polyfill");
}

it("allows active requests and rejects requests after cancellation", async () => {
  await install();
  const controller = new AbortController();
  expect(() => controller.signal.throwIfAborted()).not.toThrow();
  controller.abort();
  expect(() => controller.signal.throwIfAborted()).toThrow(
    expect.objectContaining({ name: "AbortError" })
  );
});

it.each([new Error("Session changed"), "cancelled", null, false, 0])(
  "preserves the exact cancellation reason %s",
  async (reason) => {
    await install();
    const controller = new AbortController();
    controller.abort(reason);
    let caught: unknown = Symbol("not thrown");
    try {
      controller.signal.throwIfAborted();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(reason);
  }
);

it("supports native signals without reason or DOMException", async () => {
  // This is the implementation installed by React Native's setUpXHR.
  vi.stubGlobal("AbortSignal", NativeAbortSignal);
  vi.stubGlobal("DOMException", undefined);
  try {
    await install();
    const controller = new NativeAbortController();
    const signal = controller.signal as AbortSignal;
    expect(() => signal.throwIfAborted()).not.toThrow();
    controller.abort();
    expect(() => signal.throwIfAborted()).toThrow(expect.objectContaining({ name: "AbortError" }));
  } finally {
    Reflect.deleteProperty(NativeAbortSignal.prototype, "throwIfAborted");
  }
});

it("preserves an existing runtime implementation", async () => {
  const implementation = vi.fn();
  Object.defineProperty(AbortSignal.prototype, "throwIfAborted", {
    configurable: true,
    value: implementation,
  });
  await import("./abort-signal-polyfill");
  expect(AbortSignal.prototype.throwIfAborted).toBe(implementation);
});
