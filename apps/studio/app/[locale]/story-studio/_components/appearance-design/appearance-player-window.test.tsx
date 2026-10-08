// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_EXPERIENCE_APPEARANCE } from "@repo/shared/experience-runtime";
import { appearancePreviewRuntime } from "../../../dev/appearance-preview/preview-runtime";
import { AppearancePlayerWindow } from "./appearance-player-window";
import { AppearancePlayerFrame } from "./appearance-player-frame";
import { PreviewPlayerCommandSchema } from "./appearance-player-bridge";

const observed = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/experience-runtime/experience-runtime-player", () => ({
  ExperienceRuntimePlayer: ({
    ui,
  }: {
    ui: { appearance: { presentation?: { copy?: { start: { "en-US"?: string } } } } };
  }) => {
    const [position, setPosition] = useState(0);
    useEffect(() => {
      observed.mounts++;
    }, []);
    return (
      <button
        data-position={position}
        data-label={ui.appearance.presentation?.copy?.start["en-US"] ?? "Start"}
        onClick={() => setPosition(5100)}
      >
        Pause
      </button>
    );
  },
}));

let root: Root;
let host: HTMLDivElement;
let runtime: Awaited<ReturnType<typeof appearancePreviewRuntime>>;
const appearance = DEFAULT_EXPERIENCE_APPEARANCE;
const peer = { postMessage: vi.fn() } as unknown as Window;
beforeEach(async () => {
  runtime = await appearancePreviewRuntime();
  observed.mounts = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(window, "parent", "get").mockReturnValue(peer);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
const send = async (data: unknown, source: Window = peer, origin = window.location.origin) => {
  await act(async () =>
    window.dispatchEvent(new MessageEvent("message", { data, source, origin }))
  );
};
const initialize = (revision = 1) => ({
  type: "fizz.preview.initialize",
  channel: "test-window",
  revision,
  config: { runtime, locale: "zh-CN" },
  appearance,
});

it("keeps playback through appearance patches and duplicate handshakes, and rejects foreign or stale commands", async () => {
  await act(async () => root.render(<AppearancePlayerWindow channel="test-window" />));
  await send(initialize(), peer, "https://other.example");
  await send(initialize(), window);
  await send({ ...initialize(), channel: "another-window" });
  expect(host.querySelector("button")).toBeNull();
  await send(initialize());
  const player = host.querySelector("button")!;
  await act(async () => player.click());
  await send({
    type: "fizz.preview.appearance",
    channel: "test-window",
    revision: 1,
    appearance: { ...appearance, presentation: { copy: { start: { "en-US": "Enter" } } } },
  });
  await send(initialize());
  expect(host.querySelector("button")).toBe(player);
  expect(player.dataset.position).toBe("5100");
  expect(player.dataset.label).toBe("Enter");
  expect(observed.mounts).toBe(1);
  await send(initialize(2));
  await send({
    type: "fizz.preview.appearance",
    channel: "test-window",
    revision: 1,
    appearance: { ...appearance, presentation: { copy: { start: { "en-US": "Enter" } } } },
  });
  expect(host.querySelector("button")?.dataset.label).toBe("Start");
  expect(observed.mounts).toBe(2);
  expect(PreviewPlayerCommandSchema.safeParse({ ...initialize(), execute: "script" }).success).toBe(
    false
  );
  expect(
    PreviewPlayerCommandSchema.safeParse({
      ...initialize(),
      appearance: { ...appearance, size: 99 },
    }).success
  ).toBe(false);
});

it("updates only appearance in the same iframe and ignores events from other windows, channels and runtime versions", async () => {
  const onState = vi.fn();
  await act(async () =>
    root.render(
      <AppearancePlayerFrame
        runtime={runtime}
        locale="zh-CN"
        appearance={appearance}
        onPreviewStateChange={onState}
      />
    )
  );
  const frame = host.querySelector("iframe")!;
  const channel = new URL(frame.src).searchParams.get("channel")!;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  await send({ type: "fizz.preview.ready", channel }, frame.contentWindow!);
  expect(post).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: "fizz.preview.initialize", revision: 1 }),
    window.location.origin
  );
  post.mockClear();
  await act(async () =>
    root.render(
      <AppearancePlayerFrame
        runtime={runtime}
        locale="zh-CN"
        appearance={{ ...appearance }}
        onPreviewStateChange={onState}
      />
    )
  );
  expect(post).not.toHaveBeenCalled();
  await act(async () =>
    root.render(
      <AppearancePlayerFrame
        runtime={runtime}
        locale="zh-CN"
        appearance={{ ...appearance, presentation: { copy: { start: { "en-US": "Enter" } } } }}
        onPreviewStateChange={onState}
      />
    )
  );
  expect(host.querySelector("iframe")).toBe(frame);
  expect(post.mock.calls.map(([message]) => message.type)).toEqual(["fizz.preview.appearance"]);
  const state = {
    type: "fizz.preview.state",
    channel,
    revision: 1,
    state: { values: { score: 5 }, completedEndingIds: [] },
  };
  await send(state, window);
  await send(state, frame.contentWindow!, "https://other.example");
  await send({ ...state, channel: "wrong" }, frame.contentWindow!);
  await send({ ...state, revision: 2 }, frame.contentWindow!);
  expect(onState).not.toHaveBeenCalled();
  await send(state, frame.contentWindow!);
  expect(onState).toHaveBeenCalledWith(state.state);
  expect(frame.getAttribute("allow")).toContain("fullscreen 'none'");
});
