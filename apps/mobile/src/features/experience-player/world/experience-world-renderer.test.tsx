import React, { act, StrictMode, useEffect, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExperienceWorldRenderer } from "./experience-world-renderer";
const h = vi.hoisted(() => ({
  active: true,
  ready: true,
  frame: null as any,
  commands: [] as any[],
  create: vi.fn(),
  bind: vi.fn(),
  close: vi.fn(),
  deferPause: false,
  finishPause: null as (() => void) | null,
}));
const id = (n: number) => `${n}1111111-1111-4111-8111-111111111111`;
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "41111111-1111-4111-8111-111111111111" },
}));
vi.mock("@/hooks/use-app-active", () => ({ useGatedScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("@tabler/icons-react-native", () => ({
  IconArrowBarUp: () => null,
  IconArrowDown: () => null,
  IconArrowUp: () => null,
  IconArrowLeft: () => null,
  IconArrowRight: () => null,
  IconPlayerStop: () => null,
}));
vi.mock("react-native", () => ({
  ActivityIndicator: () => <span>loading</span>,
  View: ({ children }: any) => <div>{children}</div>,
  Pressable: ({ children, onPress, disabled, accessibilityLabel }: any) => (
    <button disabled={disabled} onClick={onPress} aria-label={accessibilityLabel}>
      {children}
    </button>
  ),
  StyleSheet: { create: (value: any) => value, absoluteFill: {} },
}));
vi.mock("./world-travel-api", () => ({
  createWorldTravelApi: () => ({
    createWorldSession: h.create,
    bindWorldTravel: h.bind,
    closeWorldSession: h.close,
    reportWorldTravelStatus: vi.fn().mockResolvedValue({}),
    heartbeatWorldSession: vi.fn(),
    refreshWorldSessionToken: vi.fn(),
  }),
}));
vi.mock("./world-runtime-frame", () => ({
  WorldRuntimeFrame: function Frame(props: any) {
    h.frame = props;
    useImperativeHandle(props.ref, () => ({
      send(command: any) {
        h.commands.push(command);
        const reply = (value?: unknown) =>
          props.onMessage(
            JSON.stringify({
              sessionId: command.sessionId,
              type: "result",
              requestId: command.requestId,
              value,
            })
          );
        if (command.type === "start") {
          props.onMessage(
            JSON.stringify({ sessionId: command.sessionId, type: "status", status: "PLAYING" })
          );
          reply({
            providerTravelId: "provider-travel",
            firstFrameUrl: null,
            maxExperienceSeconds: 90,
          });
        } else if (command.type === "pause" && h.deferPause) h.finishPause = reply;
        else reply();
      },
    }));
    useEffect(() => {
      if (!h.ready) return;
      const timer = setTimeout(
        () =>
          h.frame.onMessage(
            JSON.stringify({ sessionId: "41111111-1111-4111-8111-111111111111", type: "ready" })
          ),
        0
      );
      return () => clearTimeout(timer);
    }, []);
    return <div data-testid="world-frame" />;
  },
}));
let root: Root, host: HTMLDivElement;
let props: React.ComponentProps<typeof ExperienceWorldRenderer>;
async function flush() {
  for (let i = 0; i < 4; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
}
const count = (type: string) => h.commands.filter((c) => c.type === type).length;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  h.active = true;
  h.ready = true;
  h.commands = [];
  h.deferPause = false;
  h.finishPause = null;
  h.create.mockResolvedValue({
    id: id(5),
    providerKey: "fal:happy-oyster",
    maxExperienceSeconds: 90,
    heartbeatIntervalSeconds: 30,
    connection: {
      apiBaseUrl: "https://fixture.invalid",
      token: "fixture",
      ticket: "fixture",
      tokenExpiresIn: 60,
    },
  });
  h.bind.mockResolvedValue({ id: id(6) });
  h.close.mockResolvedValue({ closed: true });
  props = {
    scope: { generation: 1, workspaceId: id(1), projectId: id(2), worldId: id(3) },
    config: {
      projectId: id(2),
      worldId: id(3),
      maxExperienceSeconds: 90,
      autoplay: true,
      entryInstruction: "Explore",
    },
    onCompleted: vi.fn(),
    onError: vi.fn(),
    onEndHandle: vi.fn(),
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
async function render() {
  await act(async () =>
    root.render(
      <StrictMode>
        <ExperienceWorldRenderer {...props} />
      </StrictMode>
    )
  );
}
it("starts once under effect replay, instructs once, moves and finishes through the real controller/bridge", async () => {
  await render();
  await flush();
  expect(h.create).toHaveBeenCalledOnce();
  expect(h.bind).toHaveBeenCalledOnce();
  expect(count("start")).toBe(1);
  expect(count("instruct")).toBe(1);
  await act(async () =>
    (host.querySelector('[aria-label="play.world.forward"]') as HTMLButtonElement).click()
  );
  expect(h.commands.find((c) => c.type === "move").command).toEqual({ movement: "forward" });
  await act(async () =>
    (host.querySelector('[aria-label="play.world.jump"]') as HTMLButtonElement).click()
  );
  expect(h.commands.filter((c) => c.type === "move").at(-1).command).toEqual({
    interaction: "jump",
  });
  await act(async () =>
    (host.querySelector('[aria-label="play.world.finish"]') as HTMLButtonElement).click()
  );
  await flush();
  expect(h.close).toHaveBeenCalledOnce();
  expect(props.onCompleted).toHaveBeenCalledOnce();
  expect(props.onError).not.toHaveBeenCalled();
});
it("waits for an explicit start when autoplay is disabled", async () => {
  props.config.autoplay = false;
  await render();
  await flush();
  expect(h.create).not.toHaveBeenCalled();
  const button = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === "play.start"
  )!;
  await act(async () => button.click());
  await flush();
  expect(h.create).toHaveBeenCalledOnce();
});
it("reconciles a resume requested while the pause response is still pending", async () => {
  await render();
  await flush();
  h.deferPause = true;
  h.active = false;
  await render();
  await flush();
  expect(count("pause")).toBe(1);
  h.active = true;
  await render();
  await flush();
  expect(count("resume")).toBe(0);
  await act(async () => h.finishPause!());
  await flush();
  expect(count("resume")).toBe(1);
  expect(count("start")).toBe(1);
  expect(props.onError).not.toHaveBeenCalled();
});
it("does not open a session offscreen and rejects a cross-project renderer", async () => {
  h.active = false;
  await render();
  await flush();
  expect(h.create).not.toHaveBeenCalled();
  props = { ...props, scope: { ...props.scope, projectId: id(7) } };
  await render();
  await flush();
  expect(props.onError).toHaveBeenCalledWith(
    expect.objectContaining({ message: "World playback project scope mismatch." })
  );
  expect(h.create).not.toHaveBeenCalled();
});
it("closes an acquired session on exit without reporting story completion", async () => {
  await render();
  await flush();
  await act(async () => root.render(null));
  await flush();
  expect(h.close).toHaveBeenCalledOnce();
  expect(props.onCompleted).not.toHaveBeenCalled();
});

it("ignores a session creation failure arriving after the scene has left", async () => {
  let reject!: (error: Error) => void;
  h.create.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  await render();
  await flush();
  await act(async () => root.render(null));
  await act(async () => reject(new Error("Late provider failure")));
  await flush();
  expect(props.onError).not.toHaveBeenCalled();
  expect(props.onCompleted).not.toHaveBeenCalled();
  expect(count("start")).toBe(0);
});

it("treats frame loss as failure instead of successful exploration completion", async () => {
  await render();
  await flush();
  await act(async () => h.frame.onError(new Error("Playback process terminated")));
  await flush();
  expect(props.onError).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Playback process terminated" })
  );
  expect(h.close).toHaveBeenCalledOnce();
  expect(props.onCompleted).not.toHaveBeenCalled();
});

it("leaves the embedded tap recovery visible and disables movement until playback resumes", async () => {
  await act(async () => root.render(<ExperienceWorldRenderer {...props} />));
  await flush();
  const message = (blocked: boolean) =>
    h.frame.onMessage(
      JSON.stringify({
        sessionId: "41111111-1111-4111-8111-111111111111",
        type: "playback-blocked",
        blocked,
      })
    );
  await act(async () => message(true));
  expect(host.querySelector<HTMLButtonElement>('[aria-label="play.world.forward"]')!.disabled).toBe(
    true
  );
  expect(host.textContent).not.toContain("play.world.connecting");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="play.world.finish"]')!.disabled).toBe(
    false
  );
  await act(async () => message(false));
  expect(host.querySelector<HTMLButtonElement>('[aria-label="play.world.forward"]')!.disabled).toBe(
    false
  );
  expect(h.create).toHaveBeenCalledOnce();
});

it("reports a missing embedded-player handshake without opening a paid session", async () => {
  h.ready = false;
  await render();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15001);
  });
  expect(props.onError).toHaveBeenCalledOnce();
  expect(props.onError).toHaveBeenCalledWith(
    expect.objectContaining({ message: "World playback surface did not load." })
  );
  expect(h.create).not.toHaveBeenCalled();
  expect(props.onCompleted).not.toHaveBeenCalled();
  await act(async () =>
    h.frame.onMessage(
      JSON.stringify({
        sessionId: "41111111-1111-4111-8111-111111111111",
        type: "ready",
      })
    )
  );
  await flush();
  expect(h.create).not.toHaveBeenCalled();
});

it("does not report a missing handshake after leaving the scene", async () => {
  h.ready = false;
  await render();
  await act(async () => root.render(null));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15001);
  });
  expect(props.onError).not.toHaveBeenCalled();
  expect(h.create).not.toHaveBeenCalled();
  expect(props.onCompleted).not.toHaveBeenCalled();
});
