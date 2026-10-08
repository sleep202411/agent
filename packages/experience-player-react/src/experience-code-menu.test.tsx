// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { GAME_ACTIONS, createGameSession, type GameSnapshot } from "@repo/game-sdk";
import { ExperienceCodeMenu } from "./experience-code-menu";

let root: Root | undefined, container: HTMLElement | undefined;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  container?.remove();
  root = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const artifact = {
  apiVersion: 1 as const,
  surface: "main-menu" as const,
  artifactHash: "a".repeat(64),
  sourceHash: "b".repeat(64),
  toolchain: "test",
  javascript: "var FizzGameUI={mount(){}}",
  css: "",
};
const failureCopy = { failed: "Menu failed", retry: "Retry", restore: "Use native menu" };
async function fixture() {
  const execute = vi.fn(() => true);
  let snapshot: GameSnapshot = {
    screen: "menu",
    started: false,
    status: "ready",
    mapOpen: false,
    actions: Object.fromEntries(
      GAME_ACTIONS.map((action) => [action, true])
    ) as GameSnapshot["actions"],
  };
  const { session, publish } = createGameSession({
    isActive: () => true,
    read: () => snapshot,
    execute,
  });
  const channels: { port1: MessagePort; port2: MessagePort }[] = [];
  const newPort = () =>
    ({
      onmessage: null,
      start: vi.fn(),
      close: vi.fn(),
      postMessage: vi.fn(),
    }) as unknown as MessagePort;
  vi.stubGlobal(
    "MessageChannel",
    class {
      port1 = newPort();
      port2 = newPort();
      constructor() {
        channels.push(this);
      }
    }
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const props = {
    artifact,
    title: "Home",
    session,
    copy: {
      start: "Start",
      starting: "Starting",
      loading: "Loading",
      continue: "Continue",
      restart: "Restart",
      map: "Map",
    },
    failureCopy,
  };
  const render = async (nextArtifact = artifact) => {
    await act(() => root!.render(<ExperienceCodeMenu {...props} artifact={nextArtifact} />));
  };
  await render();
  const frame = container.querySelector("iframe")!;
  const credential = /const credential = ("[^"]+")/.exec(frame.srcdoc)![1]!;
  return {
    frame,
    credential: JSON.parse(credential),
    channels,
    execute,
    render,
    setMapOpen: (mapOpen: boolean) => {
      snapshot = { ...snapshot, mapOpen };
      publish();
    },
  };
}
it("uses an opaque sandbox and transfers a port only to its exact frame and credential", async () => {
  const f = await fixture();
  expect(f.frame.getAttribute("sandbox")).toBe("allow-scripts");
  const message = { type: "fizz.game.ready", credential: f.credential };
  for (const data of [
    { source: window, origin: "null", data: message },
    { source: f.frame.contentWindow, origin: window.location.origin, data: message },
    { source: f.frame.contentWindow, origin: "null", data: { ...message, credential: "stale" } },
  ])
    window.dispatchEvent(new MessageEvent("message", data));
  expect(f.channels).toHaveLength(0);
  await act(() =>
    window.dispatchEvent(
      new MessageEvent("message", { source: f.frame.contentWindow, origin: "null", data: message })
    )
  );
  expect(f.channels).toHaveLength(1);
  expect(f.channels[0]!.port1.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "initialize",
      context: expect.objectContaining({ title: "Home" }),
    })
  );
  await act(() => root!.unmount());
  root = undefined;
  expect(f.channels[0]!.port1.close).toHaveBeenCalled();
});
it("shows the actual runtime error with a working recovery action", async () => {
  const f = await fixture();
  await act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: f.frame.contentWindow,
        origin: "null",
        data: { type: "fizz.game.ready", credential: f.credential },
      })
    )
  );
  await act(() =>
    f.channels[0]!.port1.onmessage!({
      data: { type: "error", message: "Unknown game method" },
    } as MessageEvent)
  );
  expect(container!.textContent).toContain("Unknown game method");
  expect(container!.querySelector("iframe")).toBeNull();
  const restore = [...container!.querySelectorAll("button")].find(
    (button) => button.textContent === "Use native menu"
  )!;
  await act(() => restore.click());
  expect(container!.textContent).toContain("Start");
  expect(container!.textContent).toContain("Map");
});

it("replaces the sandbox and revokes its old port when the artifact changes", async () => {
  const f = await fixture();
  await act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: f.frame.contentWindow,
        origin: "null",
        data: { type: "fizz.game.ready", credential: f.credential },
      })
    )
  );
  await f.render({
    ...artifact,
    artifactHash: "c".repeat(64),
    javascript: "var FizzGameUI={mount(){return ()=>{}}}",
  });
  const next = container!.querySelector("iframe")!;
  expect(next).not.toBe(f.frame);
  expect(next.srcdoc).not.toContain(JSON.stringify(f.credential));
  expect(f.channels[0]!.port1.close).toHaveBeenCalled();
  expect(container!.querySelector('[role="alert"]')).toBeNull();
});

it("sends enabled controls before restoring focus when the host map closes", async () => {
  const f = await fixture();
  await act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: f.frame.contentWindow,
        origin: "null",
        data: { type: "fizz.game.ready", credential: f.credential },
      })
    )
  );
  await act(() => f.setMapOpen(true));
  const send = vi.mocked(f.channels[0]!.port1.postMessage);
  send.mockClear();
  await act(() => f.setMapOpen(false));
  expect(send.mock.calls.map(([message]) => message.type)).toEqual(["snapshot", "focus"]);
});
