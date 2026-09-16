import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioPlayer } from "./audio-player";

const h = vi.hoisted(() => ({ create: vi.fn(), error: vi.fn() }));
vi.mock("wavesurfer.js", () => ({ default: { create: h.create } }));
vi.mock("sonner", () => ({ toast: { error: h.error } }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
function deferred() {
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((_, r) => {
    reject = r;
  });
  return { promise, reject };
}
function instance() {
  const handlers = new Map<string, () => void>();
  return {
    on: vi.fn((name: string, fn: () => void) => handlers.set(name, fn)),
    load: vi.fn().mockResolvedValue(undefined),
    playPause: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
    getDuration: () => 125,
    getCurrentTime: () => 61,
    emit: (name: string) => handlers.get(name)?.(),
  };
}
describe("audio preview ownership", () => {
  let root: Root, container: HTMLDivElement;
  let players: ReturnType<typeof instance>[];
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    players = [];
    h.error.mockReset();
    h.create.mockReset().mockImplementation(() => {
      const p = instance();
      players.push(p);
      return p;
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const render = async (src: string) => {
    await act(async () => root.render(<AudioPlayer src={src} />));
  };
  it("resets controls and timestamps for a replacement file", async () => {
    await render("first");
    act(() => {
      players[0]!.emit("ready");
      players[0]!.emit("play");
      players[0]!.emit("audioprocess");
    });
    expect(container.textContent).toContain("1:01 / 2:05");
    await render("second");
    expect(container.querySelector("button")!.disabled).toBe(true);
    expect(container.textContent).toContain("0:00 / 0:00");
    expect(players[0]!.destroy).toHaveBeenCalledOnce();
  });
  it("ignores queued events from the destroyed player", async () => {
    await render("first");
    const old = players[0]!;
    await render("second");
    act(() => {
      old.emit("ready");
      old.emit("audioprocess");
    });
    expect(container.querySelector("button")!.disabled).toBe(true);
    expect(container.textContent).toContain("0:00 / 0:00");
  });
  it("consumes abandoned load rejection without feedback", async () => {
    const pending = deferred();
    h.create.mockImplementationOnce(() => {
      const p = instance();
      p.load.mockReturnValue(pending.promise);
      players.push(p);
      return p;
    });
    await render("first");
    await render("second");
    await act(async () => pending.reject(new Error("abandoned")));
    expect(h.error).not.toHaveBeenCalled();
  });
  it("reports active load failure", async () => {
    h.create.mockImplementationOnce(() => {
      const p = instance();
      p.load.mockRejectedValue(new Error("Unavailable audio"));
      return p;
    });
    await render("first");
    expect(h.error).toHaveBeenCalledWith("Unavailable audio");
    expect(container.querySelector("button")!.disabled).toBe(true);
  });
  it("retains retry after playback rejection", async () => {
    await render("first");
    act(() => players[0]!.emit("ready"));
    players[0]!.playPause.mockRejectedValueOnce(new Error("Playback blocked"));
    await act(async () => container.querySelector("button")!.click());
    expect(h.error).toHaveBeenCalledWith("Playback blocked");
    await act(async () => container.querySelector("button")!.click());
    expect(players[0]!.playPause).toHaveBeenCalledTimes(2);
  });
});
