// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HlsPreviewPlayer } from "./hls-preview-player";

const fake = vi.hoisted(() => {
  type Listener = (event: string, data: unknown) => void;
  const state = {
    supported: true,
    instances: [] as FakeHls[],
  };
  class FakeHls {
    static Events = {
      MANIFEST_PARSED: "hlsManifestParsed",
      LEVELS_UPDATED: "hlsLevelsUpdated",
      LEVEL_SWITCHED: "hlsLevelSwitched",
      ERROR: "hlsError",
    };
    static isSupported() {
      return state.supported;
    }
    levels: { uri: string; width: number; height: number; bitrate: number }[] = [];
    currentLevel = -1;
    listeners = new Map<string, Listener>();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    constructor() {
      state.instances.push(this);
    }
    on(event: string, listener: Listener) {
      this.listeners.set(event, listener);
    }
    emit(event: string, data: unknown) {
      this.listeners.get(event)?.(event, data);
    }
  }
  return { state, FakeHls };
});
vi.mock("hls.js", () => ({ default: fake.FakeHls }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MASTER = "https://media.fizzspace.cn/hls/0199a1b2-c3d4-7e5f-9a9b-000000000001/master.m3u8";
const LEVELS = [
  { uri: MASTER.replace("master", "480p"), width: 854, height: 480, bitrate: 800_000 },
  { uri: MASTER.replace("master", "720p"), width: 1280, height: 720, bitrate: 1_400_000 },
  { uri: MASTER.replace("master", "1080p"), width: 1920, height: 1080, bitrate: 2_456_000 },
];
let root: Root | undefined;
let container: HTMLDivElement;

async function mount() {
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root!.render(<HlsPreviewPlayer url={MASTER} />));
  await act(async () => {
    await vi.waitFor(() => {
      if (!fake.state.instances.length && !container.querySelector('[role="alert"]')) {
        throw new Error("hls.js not loaded yet");
      }
    });
  });
  return fake.state.instances[0];
}
const options = () =>
  [...container.querySelectorAll('[role="radio"]')].map((button) => button.textContent);
const choose = (label: string) =>
  act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      .find((button) => button.textContent === label)!
      .click()
  );

beforeEach(() => {
  fake.state.supported = true;
  fake.state.instances = [];
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
});

it("loads the master into the video and switches quality from hls.levels", async () => {
  const hls = (await mount())!;
  expect(hls.loadSource).toHaveBeenCalledWith(MASTER);
  expect(hls.attachMedia).toHaveBeenCalledWith(container.querySelector("video"));
  expect(options()).toEqual(["自动"]);

  hls.levels = LEVELS;
  await act(async () => hls.emit(fake.FakeHls.Events.MANIFEST_PARSED, { levels: LEVELS }));
  expect(options()).toEqual(["自动", "1080p", "720p", "480p"]);

  await choose("720p");
  expect(hls.currentLevel).toBe(1);
  await act(async () => hls.emit(fake.FakeHls.Events.LEVEL_SWITCHED, { level: 1 }));
  expect(container.textContent).toContain("720p · 1280×720 · 1.40 Mbps");
  expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe("720p");

  await choose("自动");
  expect(hls.currentLevel).toBe(-1);
  expect(container.textContent).toContain("自动 · 720p · 1280×720 · 1.40 Mbps");
});

it("shows fatal errors verbatim and ignores recoverable ones", async () => {
  const hls = (await mount())!;
  await act(async () =>
    hls.emit(fake.FakeHls.Events.ERROR, {
      fatal: false,
      details: "bufferStalledError",
    })
  );
  expect(container.querySelector('[role="alert"]')).toBeNull();

  await act(async () =>
    hls.emit(fake.FakeHls.Events.ERROR, {
      fatal: true,
      details: "manifestLoadError",
      response: { code: 403, url: MASTER },
      url: MASTER,
    })
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    `manifestLoadError · HTTP 403 · ${MASTER}`
  );

  const segment = MASTER.replace("master.m3u8", "720p-3.ts");
  await act(async () =>
    hls.emit(fake.FakeHls.Events.ERROR, {
      fatal: true,
      details: "fragLoadError",
      frag: { url: segment },
    })
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    `fragLoadError · HTTP - · ${segment}`
  );
});

it("explains a browser without MediaSource instead of falling back", async () => {
  fake.state.supported = false;
  await mount();
  expect(fake.state.instances).toHaveLength(0);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "当前浏览器不支持 MediaSource，无法预览 HLS。"
  );
});

it("destroys the hls.js instance on unmount", async () => {
  const hls = (await mount())!;
  expect(hls.destroy).not.toHaveBeenCalled();
  await act(async () => root!.unmount());
  root = undefined;
  expect(hls.destroy).toHaveBeenCalledTimes(1);
});
