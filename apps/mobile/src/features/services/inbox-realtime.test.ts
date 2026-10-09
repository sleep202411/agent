import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { openInboxRealtime } from "./inbox-realtime";
const h = vi.hoisted(() => ({
  generation: 1,
  options: {} as any,
  message: undefined as any,
  channelState: undefined as any,
  connectionState: undefined as any,
  close: vi.fn(),
  unsubscribe: vi.fn(),
  channel: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("ably", () => ({
  Realtime: class {
    constructor(options: unknown) {
      h.options = options;
    }
    channels = {
      get: (name: string) => {
        h.channel(name);
        return {
          subscribe: (_: string, fn: unknown) => {
            h.message = fn;
            return Promise.resolve();
          },
          on: (fn: unknown) => {
            h.channelState = fn;
          },
          unsubscribe: h.unsubscribe,
        };
      },
    };
    connection = {
      on: (fn: unknown) => {
        h.connectionState = fn;
      },
    };
    connect() {}
    close = h.close;
  },
}));
const grant = { channel: "conversation:user:1", tokenRequest: { clientId: "1", mac: "signed" } };
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("uses the authenticated grant and invalidates after attach and relevant events", async () => {
  const refresh = vi.fn(),
    error = vi.fn();
  const close = openInboxRealtime("1", 1, refresh, error);
  vi.mocked(api.get).mockResolvedValue(grant);
  const callback = vi.fn();
  h.options.authCallback({}, callback);
  await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(null, grant.tokenRequest));
  expect(h.channel).toHaveBeenCalledWith("conversation:user:1");
  h.channelState({ current: "attached" });
  h.message({ data: { event: "message.created" } });
  h.message({ data: { event: "read.advanced" } });
  h.message({ data: { event: "other" } });
  expect(refresh).toHaveBeenCalledTimes(3);
  close();
  close();
  expect(h.close).toHaveBeenCalledOnce();
  h.message({ data: { event: "message.created" } });
  expect(refresh).toHaveBeenCalledTimes(3);
});
it("rejects a grant for another account", async () => {
  const error = vi.fn();
  const close = openInboxRealtime("1", 1, vi.fn(), error);
  vi.mocked(api.get).mockResolvedValue({ ...grant, channel: "conversation:user:2" });
  const callback = vi.fn();
  h.options.authCallback({}, callback);
  await vi.waitFor(() => expect(error).toHaveBeenCalled());
  expect(callback).toHaveBeenCalledWith("Realtime grant identity mismatch", null);
  close();
});
it("does not authorize or process events after session generation changes", () => {
  const refresh = vi.fn();
  const close = openInboxRealtime("1", 1, refresh, vi.fn());
  h.generation = 2;
  const callback = vi.fn();
  h.options.authCallback({}, callback);
  h.message({ data: { event: "message.created" } });
  expect(api.get).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  expect(callback).toHaveBeenCalledWith("Session changed", null);
  close();
});
it("aborts pending grant requests on close and terminates revoked connections", async () => {
  const error = vi.fn();
  const close = openInboxRealtime("1", 1, vi.fn(), error);
  vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
  h.options.authCallback({}, vi.fn());
  h.message({ data: { event: "terminate" } });
  expect(error).toHaveBeenCalledOnce();
  expect(vi.mocked(api.get).mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(h.close).toHaveBeenCalledOnce();
  close();
});
