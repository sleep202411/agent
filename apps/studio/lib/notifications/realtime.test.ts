import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONVERSATION_REALTIME_EVENT, conversationChannel } from "@repo/shared/conversation";

type AuthCallback = (
  params: object,
  callback: (error: string | null, token: unknown) => void
) => void;
const state = vi.hoisted(() => ({
  auth: undefined as AuthCallback | undefined,
  ready: undefined as (() => void) | undefined,
  receive: undefined as ((message: { data: unknown }) => void) | undefined,
  get: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  unsubscribe: vi.fn(),
  apiGet: vi.fn(),
  event: "",
}));
vi.mock("ably", () => ({
  Realtime: class {
    constructor(options: { authCallback: AuthCallback }) {
      state.auth = options.authCallback;
    }
    channels = {
      get: (name: string) => {
        state.get(name);
        return {
          on: (_event: string, fn: () => void) => {
            state.ready = fn;
          },
          subscribe: (event: string, fn: (message: { data: unknown }) => void) => {
            state.event = event;
            state.receive = fn;
            return Promise.resolve();
          },
          unsubscribe: state.unsubscribe,
        };
      },
    };
    connect = state.connect;
    close = state.close;
  },
}));
vi.mock("@/lib/api", () => ({ api: { get: state.apiGet } }));
import { openNotificationsRealtime } from "./realtime";

beforeEach(() => vi.clearAllMocks());

describe("Studio notification subscription", () => {
  it("uses the server's current authenticated channel and notification frame", async () => {
    state.apiGet.mockResolvedValue({ tokenRequest: { nonce: "test-token" } });
    const onNotification = vi.fn(),
      onReady = vi.fn();
    const client = openNotificationsRealtime("user1", { onNotification, onReady });
    expect(state.get).toHaveBeenCalledWith(conversationChannel("user1"));
    expect(state.event).toBe(CONVERSATION_REALTIME_EVENT);
    const callback = vi.fn();
    state.auth!({}, callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(null, { nonce: "test-token" }));
    expect(state.apiGet).toHaveBeenCalledWith("/aurora/conversations/realtime-token", {
      requestScope: "user",
      cache: "no-store",
    });
    state.ready!();
    state.ready!();
    expect(onReady).toHaveBeenCalledTimes(2);
    state.receive!({ data: { event: "message.created", data: {} } });
    expect(onNotification).not.toHaveBeenCalled();
    const notification = { id: "n1", type: "story-project.member.added" };
    state.receive!({ data: { event: "notification.created", data: notification } });
    expect(onNotification).toHaveBeenCalledWith(notification);
    client.close();
    client.close();
    state.ready!();
    state.receive!({ data: { event: "notification.created", data: notification } });
    expect(state.close).toHaveBeenCalledTimes(1);
    expect(state.unsubscribe).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledTimes(2);
    expect(onNotification).toHaveBeenCalledTimes(1);
  });
});
