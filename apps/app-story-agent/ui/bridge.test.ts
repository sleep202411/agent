// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_STORY_BRIDGE_PROTOCOL,
  type StoryBridgeInit,
  type StoryBridgeOutbound,
} from "@repo/app-story-protocol";
import { StoryBridge, connectStoryBridge } from "./bridge";
import { loadContext, StoryTransport } from "./transport";

const projectId = "00000000-0000-4000-8000-000000000001";
const chapterId = "00000000-0000-4000-8000-000000000002";
const init: StoryBridgeInit = {
  projectId,
  chapterId,
  locale: "en-US",
  capabilities: ["saveResource", "shareResource"],
};
const bridges: StoryBridge[] = [];
const transports: StoryTransport[] = [];
function create() {
  const messages: StoryBridgeOutbound[] = [];
  const bridge = new StoryBridge((message) => messages.push(JSON.parse(message)));
  bridges.push(bridge);
  const receive = (
    type: string,
    payload: unknown,
    requestId: string = crypto.randomUUID(),
    bridgeId: string = bridge.id
  ) => {
    bridge.receive(
      JSON.stringify({ protocol: APP_STORY_BRIDGE_PROTOCOL, bridgeId, requestId, type, payload })
    );
    return requestId;
  };
  receive("init", init);
  return { bridge, messages, receive };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
afterEach(() => {
  bridges.splice(0).forEach((bridge) => bridge.dispose());
  transports.splice(0).forEach((transport) => transport.dispose());
  delete window.FizzDragonStoryBridge;
  delete window.ReactNativeWebView;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Native H5 bridge boundary", () => {
  it("keeps unsupported native resource actions hidden and never dispatches them", async () => {
    const post = vi.fn();
    const bridge = new StoryBridge(post);
    bridges.push(bridge);
    bridge.receive(
      JSON.stringify({
        protocol: APP_STORY_BRIDGE_PROTOCOL,
        bridgeId: bridge.id,
        requestId: crypto.randomUUID(),
        type: "init",
        payload: { projectId, chapterId, locale: "en-US" },
      })
    );
    await expect(bridge.context).resolves.toMatchObject({ capabilities: [] });
    expect(bridge.supports("saveResource")).toBe(false);
    expect(bridge.supports("shareResource")).toBe(false);
    await expect(
      bridge.resource("saveResource", {
        projectId,
        chapterId,
        resource: {
          id: chapterId,
          kind: "image",
          name: "Scene",
          url: "https://media.example/scene.png",
        },
      })
    ).rejects.toThrow("not available");
    await settle();
    expect(post.mock.calls.map(([raw]) => JSON.parse(raw).type)).toEqual(["result"]);
  });
  it("keeps browsers standalone and installs the receiver before native initialization", async () => {
    expect(connectStoryBridge()).toBeUndefined();
    expect(window.FizzDragonStoryBridge).toBeUndefined();
    window.ReactNativeWebView = {
      postMessage(raw) {
        const message = JSON.parse(raw);
        if (message.type === "ready")
          window.FizzDragonStoryBridge!.receive(
            JSON.stringify({
              ...message,
              type: "init",
              requestId: crypto.randomUUID(),
              payload: init,
            })
          );
      },
    };
    const bridge = connectStoryBridge()!;
    bridges.push(bridge);
    await expect(loadContext(bridge)).resolves.toEqual({
      ready: true,
      projectId,
      chapterId,
      locale: "en-US",
    });
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    expect(window.FizzDragonStoryBridge).toBeDefined();
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    expect(window.FizzDragonStoryBridge).toBeUndefined();
  });

  it("ignores malformed, credential-bearing and stale messages and cannot switch project in place", async () => {
    const { bridge, messages, receive } = create();
    const back = vi.fn(() => true);
    bridge.bind({ back, refresh: vi.fn(), pause: vi.fn() });
    bridge.receive("invalid JSON");
    bridge.receive("x".repeat(32769));
    receive("back", {}, crypto.randomUUID(), crypto.randomUUID());
    receive("back", { token: "not-a-real-token" });
    bridge.receive(
      JSON.stringify({
        protocol: "old",
        bridgeId: bridge.id,
        requestId: crypto.randomUUID(),
        type: "back",
        payload: {},
      })
    );
    expect(back).not.toHaveBeenCalled();
    receive("init", { ...init, sessionCookie: "not-a-real-cookie" });
    receive("init", { ...init, projectId: chapterId });
    await settle();
    expect(messages.at(-1)).toMatchObject({
      type: "result",
      payload: { status: "error", code: "REOPEN_REQUIRED" },
    });
    await expect(bridge.context).resolves.toEqual(init);
  });

  it("does not leave an unsupported native host loading forever", async () => {
    vi.useFakeTimers();
    const bridge = new StoryBridge(vi.fn());
    bridges.push(bridge);
    const result = expect(bridge.context).rejects.toThrow("initialization timed out");
    await vi.advanceTimersByTimeAsync(20000);
    await result;
    bridge.receive(
      JSON.stringify({
        protocol: APP_STORY_BRIDGE_PROTOCOL,
        bridgeId: bridge.id,
        requestId: crypto.randomUUID(),
        type: "init",
        payload: init,
      })
    );
    expect(bridge.supports("saveResource")).toBe(false);
  });

  it("consumes a replayed Back once and leaves native exit to the App when no surface is open", async () => {
    const { bridge, messages, receive } = create();
    const back = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    bridge.bind({ back, refresh: vi.fn(), pause: vi.fn() });
    const id = receive("back", {});
    receive("back", {}, id);
    await settle();
    expect(back).toHaveBeenCalledTimes(1);
    expect(messages.filter((message) => message.requestId === id)).toHaveLength(2);
    expect(messages.at(-1)).toMatchObject({ payload: { status: "success", handled: true } });
    receive("back", {});
    await settle();
    expect(messages.at(-1)).toMatchObject({ payload: { status: "success", handled: false } });
    expect(messages.some((message) => message.type === "close")).toBe(false);
    await bridge.back();
    expect(messages.at(-1)?.type).toBe("close");
    await bridge.back();
    expect(messages.filter((message) => message.type === "close")).toHaveLength(1);
  });

  it("buffers background state during boot and refreshes once on foreground without resuming production", async () => {
    const { bridge, receive } = create();
    receive("appState", { state: "background" });
    const pause = vi.fn(),
      refresh = vi.fn();
    bridge.bind({ back: () => false, pause, refresh });
    expect(pause).toHaveBeenLastCalledWith(true);
    receive("appState", { state: "active" });
    receive("appState", { state: "active" });
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenLastCalledWith(false);
    receive("appState", { state: "background" });
    bridge.authenticationExpired();
    receive("init", { ...init, capabilities: [...init.capabilities].reverse() });
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenLastCalledWith(true);
    receive("appState", { state: "active" });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenLastCalledWith(false);
  });

  it("recovers HTTP and business 401 together, retains upstream errors and never retries a paid command", async () => {
    const { bridge, messages, receive } = create();
    vi.stubGlobal("location", { pathname: "/h5/", search: "" });
    let expired = true;
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      expect(url).toBe(
        `/aurora/app-story-agent/projects/${projectId}/chapters/${chapterId}/outputs`
      );
      expect(options.method).toBe("GET");
      return new Response(
        JSON.stringify(expired ? { code: 401, msg: "Not logged in!" } : { code: 200, data: [] }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const transport = new StoryTransport({ ready: true, ...init }, undefined, undefined, bridge);
    transports.push(transport);
    const pause = vi.fn(),
      refresh = vi.fn();
    bridge.bind({ back: () => false, pause, refresh });
    await expect(transport.outputs()).rejects.toThrow("Not logged in!");
    await expect(transport.outputs()).rejects.toThrow("Sign in");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(messages.filter((message) => message.type === "authExpired")).toHaveLength(1);
    expect(pause).toHaveBeenLastCalledWith(true);
    expired = false;
    receive("init", init);
    await expect(transport.outputs()).resolves.toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 }))
    );
    await expect(transport.outputs()).rejects.toThrow();
    expect(bridge.authenticationRequired).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 401 }))
    );
    await expect(transport.outputs()).rejects.toThrow();
    expect(bridge.authenticationRequired).toBe(true);
  });

  it("reports upload and attachment authentication failures through the same native recovery", async () => {
    const { bridge, messages, receive } = create();
    const transport = new StoryTransport({ ready: true, ...init }, undefined, undefined, bridge);
    transports.push(transport);
    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        status = 200;
        response = { code: 401, msg: "Upload session expired" };
        upload = {};
        onload?: () => void;
        open() {}
        setRequestHeader() {}
        send() {
          this.onload?.();
        }
      }
    );
    await expect(transport.upload(new Blob(["Script"]), "script.docx")).rejects.toThrow(
      "Upload session expired"
    );
    expect(messages.filter((message) => message.type === "authExpired")).toHaveLength(1);
    receive("init", init);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "Attachment session expired" }), { status: 401 })
      )
    );
    await expect(transport.attachmentData(chapterId)).rejects.toThrow("Attachment session expired");
    expect(messages.filter((message) => message.type === "authExpired")).toHaveLength(2);
  });

  it("correlates save/share replies, treats cancellation normally and keeps native errors actionable", async () => {
    const { bridge, messages, receive } = create();
    const resource = {
      projectId,
      chapterId,
      resource: {
        id: chapterId,
        kind: "video" as const,
        name: "Scene",
        url: "https://media.example/scene.mp4",
      },
    };
    const saving = bridge.resource("saveResource", resource);
    const saveId = messages.at(-1)!.requestId;
    receive("result", { status: "success" }, saveId, crypto.randomUUID());
    receive("result", { status: "success" }, crypto.randomUUID());
    receive("result", { status: "success" }, saveId);
    await expect(saving).resolves.toBe("success");
    const sharing = bridge.resource("shareResource", resource);
    receive("result", { status: "cancelled" }, messages.at(-1)!.requestId);
    await expect(sharing).resolves.toBe("cancelled");
    const failure = bridge.resource("saveResource", resource);
    receive(
      "result",
      { status: "error", code: "NO_SPACE", message: "No storage space" },
      messages.at(-1)!.requestId
    );
    await expect(failure).rejects.toThrow("No storage space");
    for (const url of [
      "javascript:alert(1)",
      "data:text/plain,hi",
      "file:///private/file",
      "https://user:pass@media.example/video.mp4",
    ])
      await expect(
        bridge.resource("saveResource", { ...resource, resource: { ...resource.resource, url } })
      ).rejects.toThrow();
    await expect(
      bridge.resource("saveResource", { ...resource, projectId: chapterId })
    ).rejects.toThrow("does not match");
    const pending = bridge.resource("saveResource", resource);
    bridge.dispose();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
