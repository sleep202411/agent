// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "@/src/lib/api";
import { useDiscoveryAssistant } from "./use-discovery-assistant";
vi.mock("@/src/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiRequestError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
let root: Root;
let host: HTMLDivElement;
let hook: ReturnType<typeof useDiscoveryAssistant>;
const query = {
  basedIn: null,
  serves: null,
  remoteOnly: false,
  availableForWork: false,
  category: null,
  text: "",
};
const key = "discovery-assistant:viewer:en-US:creators";
const id = "11111111-1111-4111-8111-111111111111";
const request = {
  requestId: id,
  locale: "en-US",
  conversation: {
    current: { kind: "creators", query },
    messages: [{ role: "user", content: "Find studios" }],
  },
};
const response = (requestId: string, status = "succeeded") => ({
  requestId,
  status,
  result:
    status === "succeeded"
      ? { status: "clarification", question: "Based in or serving Singapore?" }
      : null,
});
function Harness({ user = "viewer" }: { user?: string | null }) {
  const value = useDiscoveryAssistant({
    viewerId: user,
    locale: "en-US",
    current: { kind: "creators", query },
    copy: {
      storage: "Storage failed",
      mismatch: "Wrong reply",
      invalid: "Invalid or too long",
      resultSummary: (count) => `${count} matching studios`,
    },
  });
  useLayoutEffect(() => {
    hook = value;
  });
  return null;
}
async function render(user: string | null = "viewer") {
  await act(async () => root.render(<Harness key={user ?? "guest"} user={user} />));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("persists before explicit dispatch and preserves conversation for a follow-up", async () => {
  await render();
  expect(api.post).not.toHaveBeenCalled();
  vi.mocked(api.post).mockImplementation(async (_url, options) => {
    const body = options!.data as typeof request;
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(body);
    return response(body.requestId);
  });
  await act(async () => hook.send("Find studios"));
  expect(hook.history).toEqual([
    { role: "user", content: "Find studios" },
    { role: "assistant", content: "Based in or serving Singapore?" },
  ]);
  await act(async () => hook.send("Based in Singapore"));
  expect(hook.history).toHaveLength(4);
  expect(api.post).toHaveBeenCalledTimes(2);
});
it("recovers a stored request by reading only, never by auto dispatch", async () => {
  sessionStorage.setItem(key, JSON.stringify(request));
  await render();
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
  expect(hook.canSend).toBe(false);
  vi.mocked(api.get).mockResolvedValue(response(id));
  await act(async () => hook.check());
  expect(hook.receipt?.status).toBe("succeeded");
  expect(api.post).not.toHaveBeenCalled();
});
it("blocks double dispatch and keeps a lost reply recoverable", async () => {
  await render();
  let reject!: (error: Error) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = hook.send("Find studios");
    void hook.send("Duplicate");
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  await act(async () => {
    reject(new Error("Lost response"));
    await pending;
  });
  expect(hook.request).not.toBeNull();
  expect(hook.canSend).toBe(false);
  expect(hook.receipt).toBeNull();
});
it("a missing receipt permits only an explicit retry of the same saved request", async () => {
  sessionStorage.setItem(key, JSON.stringify(request));
  await render();
  vi.mocked(api.get).mockRejectedValue(new ApiRequestError("missing", "Not found", 404));
  await act(async () => hook.check());
  expect(hook.missing).toBe(true);
  vi.mocked(api.post).mockResolvedValue(response(id));
  await act(async () => hook.retryMissing());
  expect(api.post).toHaveBeenCalledWith(
    "/aurora/content-gps/discovery/requests",
    expect.objectContaining({ data: request })
  );
});
it("uncertain outcomes require an explicit new conversation, never automatic retry", async () => {
  sessionStorage.setItem(key, JSON.stringify(request));
  await render();
  vi.mocked(api.get).mockResolvedValue(response(id, "uncertain"));
  await act(async () => hook.check());
  expect(hook.canSend).toBe(false);
  await act(async () => hook.retryMissing());
  expect(api.post).not.toHaveBeenCalled();
  act(() => hook.reset());
  expect(hook.canSend).toBe(true);
  expect(hook.history).toEqual([]);
});
it("cancel aborts the active dispatch and ignores a late success", async () => {
  await render();
  let resolve!: (value: unknown) => void;
  let requestId = "";
  let signal: AbortSignal | undefined;
  vi.mocked(api.post).mockImplementation(async (url, options) => {
    if (url.endsWith("/cancel")) return response(requestId, "cancelled");
    requestId = (options!.data as typeof request).requestId;
    signal = options?.signal ?? undefined;
    return new Promise((done) => {
      resolve = done;
    });
  });
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = hook.send("Find studios");
  });
  await act(async () => hook.cancel());
  expect(signal?.aborted).toBe(true);
  expect(hook.receipt?.status).toBe("cancelled");
  await act(async () => {
    resolve(response(requestId));
    await pending;
  });
  expect(hook.receipt?.status).toBe("cancelled");
});
it("account replacement cannot receive an earlier reply or transcript", async () => {
  await render();
  let resolve!: (value: unknown) => void;
  let requestId = "";
  vi.mocked(api.post).mockImplementation(async (_url, options) => {
    requestId = (options!.data as typeof request).requestId;
    return new Promise((done) => {
      resolve = done;
    });
  });
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = hook.send("Find studios");
  });
  await render("other");
  await act(async () => {
    resolve(response(requestId));
    await pending;
  });
  expect(hook.request).toBeNull();
  expect(hook.receipt).toBeNull();
  expect(hook.history).toEqual([]);
});
it("clears previous results and transcript on an authorization failure", async () => {
  sessionStorage.setItem(key, JSON.stringify(request));
  await render();
  vi.mocked(api.get).mockRejectedValue(new ApiRequestError("denied", "Session expired", 401));
  await act(async () => hook.check());
  expect(hook.denied).toBe(true);
  expect(hook.history).toEqual([]);
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(hook.canSend).toBe(false);
});
it("rejects wrong receipt identities and prevents dispatch without browser storage", async () => {
  sessionStorage.setItem(key, JSON.stringify(request));
  await render();
  vi.mocked(api.get).mockResolvedValue(response("22222222-2222-4222-8222-222222222222"));
  await act(async () => hook.check());
  expect(hook.error).toBe("Wrong reply");
  expect(hook.receipt).toBeNull();
  await render("fresh");
  vi.stubGlobal("sessionStorage", {
    setItem: () => {
      throw new Error("denied");
    },
  });
  await act(async () => hook.send("Find studios"));
  expect(hook.error).toBe("Storage failed");
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects oversized conversation input without truncation and leaves anonymous discovery untouched", async () => {
  await render();
  await act(async () => hook.send("x".repeat(2001)));
  expect(hook.error).toBe("Invalid or too long");
  expect(api.post).not.toHaveBeenCalled();
  await render(null);
  await act(async () => hook.send("Find studios"));
  expect(api.post).not.toHaveBeenCalled();
  expect(hook.canSend).toBe(false);
});

it("recovers from corrupt saved state through an explicit new conversation", async () => {
  sessionStorage.setItem(key, "{broken");
  await render();
  expect(hook.error).toBe("Storage failed");
  expect(hook.canSend).toBe(false);
  act(() => hook.reset());
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(hook.error).toBeNull();
  expect(hook.canSend).toBe(true);
  expect(api.post).not.toHaveBeenCalled();
  vi.mocked(api.post).mockImplementation(async (_url, options) => {
    const next = options!.data as typeof request;
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(next);
    return response(next.requestId);
  });
  await act(async () => hook.send("Find studios"));
  expect(api.post).toHaveBeenCalledTimes(1);
});

it("does not enable dispatch if clearing broken storage fails", async () => {
  sessionStorage.setItem(key, "{broken");
  await render();
  vi.stubGlobal("sessionStorage", {
    removeItem: () => {
      throw new Error("Unavailable");
    },
  });
  act(() => hook.reset());
  expect(hook.error).toBe("Storage failed");
  expect(hook.canSend).toBe(false);
  await act(async () => hook.send("Find studios"));
  expect(api.post).not.toHaveBeenCalled();
});
