import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_STORY_BRIDGE_PROTOCOL, type StoryBridgeInbound } from "@repo/app-story-protocol";
import {
  AppStoryNativeBridge,
  storyWebViewCookie,
  trustedStoryPage,
} from "./app-story-native-bridge";
const page = "https://api.example.com/aurora/app-story-agent/ui/index.html";
const projectId = "00000000-0000-4000-8000-000000000001";
const chapterId = "00000000-0000-4000-8000-000000000002";
function setup() {
  const messages: StoryBridgeInbound[] = [];
  const actions = {
    id: () => crypto.randomUUID(),
    send: (v: StoryBridgeInbound) => messages.push(v),
    close: vi.fn(),
    expired: vi.fn(),
    changed: vi.fn(),
    resource: vi.fn(async () => {}),
    failure: vi.fn(),
  };
  const host = new AppStoryNativeBridge(
    {
      projectId,
      chapterId,
      locale: "en-US",
      capabilities: ["saveResource"],
      initialDraft: "A new story",
    },
    page,
    actions
  );
  const bridgeId = crypto.randomUUID();
  const receive = (
    type: string,
    payload: unknown,
    requestId: string = crypto.randomUUID(),
    url = page
  ) =>
    host.receive(
      JSON.stringify({ protocol: APP_STORY_BRIDGE_PROTOCOL, bridgeId, requestId, type, payload }),
      url
    );
  const ready = () => receive("ready", { capabilities: ["saveResource"] });
  return { host, actions, messages, receive, ready };
}
afterEach(() => vi.useRealTimers());
describe("native App Story host", () => {
  it("rejects foreign pages and delivers context without credentials", () => {
    const { host, messages, receive, ready } = setup();
    receive("ready", { capabilities: [] }, crypto.randomUUID(), "https://attacker.test/");
    expect(messages).toEqual([]);
    host.state(false);
    ready();
    expect(messages.map((x) => x.type)).toEqual(["init", "appState"]);
    expect(messages[0].payload).toMatchObject({ initialDraft: "A new story", projectId });
    expect(messages[1].payload).toEqual({ state: "background" });
    expect(trustedStoryPage(page + "?token=secret", page)).toBe(false);
    expect(trustedStoryPage(page + "#panel", page)).toBe(true);
    expect(storyWebViewCookie({ tokenName: "satoken", tokenValue: "abc" })).toBe("satoken=abc");
    expect(() => storyWebViewCookie({ tokenName: "satoken", tokenValue: "abc;other=x" })).toThrow();
    host.dispose();
  });
  it("lets H5 handle back, and escapes an unresponsive WebView", () => {
    vi.useFakeTimers();
    const { host, actions, messages, receive, ready } = setup();
    ready();
    host.back();
    const back = messages.at(-1)!;
    receive("result", { status: "success", handled: true }, back.requestId);
    vi.advanceTimersByTime(3000);
    expect(actions.close).not.toHaveBeenCalled();
    host.back();
    vi.advanceTimersByTime(3000);
    expect(actions.close).toHaveBeenCalledOnce();
    host.dispose();
  });
  it("deduplicates media requests and ignores cross-project and disposed messages", async () => {
    const { host, actions, receive, ready } = setup();
    ready();
    const payload = {
      projectId,
      chapterId,
      runId: crypto.randomUUID(),
      resource: {
        id: crypto.randomUUID(),
        kind: "image",
        name: "Preview",
        url: "https://media.example.com/image.png",
      },
    };
    const id = crypto.randomUUID();
    receive("saveResource", { ...payload, projectId: crypto.randomUUID() });
    expect(actions.resource).not.toHaveBeenCalled();
    receive("saveResource", payload, id);
    receive("saveResource", payload, id);
    await Promise.resolve();
    expect(actions.resource).toHaveBeenCalledOnce();
    expect(actions.resource).toHaveBeenCalledWith("saveResource", payload);
    host.dispose();
    receive("authExpired", {});
    receive("contentChanged", { projectId, chapterId });
    expect(actions.expired).not.toHaveBeenCalled();
    expect(actions.changed).not.toHaveBeenCalled();
  });
});
