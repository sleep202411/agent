import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/src/lib/api";
import { useGenerationSubmission } from "./use-generation-submission";
import { generationReceiptKey, readGenerationReceipt } from "../_lib/generation-submission-receipt";
import type { FizzAiSubmitJobInput } from "../_lib/generation-api";

const mocks = vi.hoisted(() => ({ user: { id: "owner" }, submit: vi.fn(), list: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: mocks.user }) }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("../_lib/generation-api", () => ({
  submitFizzAiJob: mocks.submit,
  listFizzAiJobs: mocks.list,
  normalizeFizzAiError: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));
const request: FizzAiSubmitJobInput = {
  idempotencyKey: "original",
  modelId: "image-model",
  schemaVersion: "1",
  input: { prompt: "Reviewed prompt", count: 1 },
  context: {
    workspaceId: "workspace",
    projectId: "project",
    documentId: "doc",
    documentBlockId: "node",
    sourceSurface: "canvas",
  },
};
const key = generationReceiptKey("owner", "workspace", "canvas");
const job = {
  id: "accepted",
  idempotencyKey: "original",
  modelId: "image-model",
  status: "queued",
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});
const waitFor = async (assertion: () => void) =>
  vi.waitFor(async () => {
    await act(async () => {});
    assertion();
  });
function setup(onRecovered = vi.fn()) {
  const root = createRoot(document.createElement("div"));
  const result = { current: null as unknown as ReturnType<typeof useGenerationSubmission> };
  function Probe({ workspaceId }: { workspaceId: string }) {
    result.current = useGenerationSubmission({ workspaceId, surface: "canvas", onRecovered });
    return null;
  }
  const rerender = (props: { workspaceId: string }) =>
    act(() => {
      root.render(<Probe {...props} />);
    });
  let mounted = true;
  const unmount = () => {
    if (mounted) {
      act(() => root.unmount());
      mounted = false;
    }
  };
  cleanups.push(unmount);
  rerender({ workspaceId: "workspace" });
  return { result, rerender, unmount, onRecovered };
}
async function loseResponse(result: ReturnType<typeof setup>["result"]) {
  mocks.submit.mockRejectedValueOnce(new Error("Connection lost"));
  await act(async () => {
    await expect(
      result.current.submit(request, "image", { nodeId: "node", mediaId: "media" })
    ).rejects.toThrow("Connection lost");
  });
}
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  mocks.user = { id: "owner" };
  mocks.list.mockResolvedValue({ jobs: [] });
});
describe("Web generation command recovery", () => {
  it("keeps an empty lookup unresolved and replays the exact reviewed command after remount", async () => {
    const first = setup();
    await loseResponse(first.result);
    first.unmount();
    const next = setup();
    await waitFor(() => expect(next.result.current.recovery.pending).toBe(true));
    await act(async () => {
      await next.result.current.recovery.check();
    });
    expect(next.result.current.recovery.error).toBe("notFoundYet");
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    await act(async () => {
      await expect(
        next.result.current.submit(
          { ...request, idempotencyKey: "changed", input: { prompt: "Edited draft" } },
          "image",
          {}
        )
      ).rejects.toThrow("pending");
    });
    mocks.submit.mockResolvedValueOnce({ request_id: "accepted", status: "queued" });
    await act(async () => {
      await next.result.current.recovery.retryOriginal();
    });
    expect(mocks.submit).toHaveBeenLastCalledWith(request);
    expect(next.onRecovered).toHaveBeenCalledWith(
      expect.objectContaining({ id: "accepted", prompt: "Reviewed prompt" }),
      expect.objectContaining({ target: { nodeId: "node", mediaId: "media" } })
    );
    expect(readGenerationReceipt(key)).toBeNull();
  });
  it("recovers a late accepted job without another POST", async () => {
    const view = setup();
    await loseResponse(view.result);
    mocks.list.mockResolvedValueOnce({ jobs: [job] });
    await act(async () => {
      await view.result.current.recovery.retryOriginal();
    });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(view.onRecovered).toHaveBeenCalledWith(job, expect.anything());
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "original",
        documentId: "doc",
        documentBlockId: "node",
      })
    );
  });
  it("retains the receipt when replay fails or target restoration throws", async () => {
    const view = setup(
      vi.fn(() => {
        throw new Error("Target not restored");
      })
    );
    await loseResponse(view.result);
    mocks.submit.mockRejectedValueOnce(new ApiRequestError("FORBIDDEN", "Access changed", 403));
    await act(async () => {
      await view.result.current.recovery.retryOriginal();
    });
    expect(readGenerationReceipt(key)).not.toBeNull();
    mocks.list.mockResolvedValueOnce({ jobs: [job] });
    await act(async () => {
      await view.result.current.recovery.check();
    });
    expect(view.result.current.recovery.error).toBe("Target not restored");
    expect(readGenerationReceipt(key)).not.toBeNull();
  });
  it("does not apply a delayed lookup to another workspace", async () => {
    const view = setup();
    await loseResponse(view.result);
    let resolve!: (value: { jobs: (typeof job)[] }) => void;
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    let lookup!: Promise<void>;
    act(() => {
      lookup = view.result.current.recovery.retryOriginal();
    });
    view.rerender({ workspaceId: "different" });
    await act(async () => {
      resolve({ jobs: [job] });
      await lookup;
    });
    expect(view.onRecovered).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(readGenerationReceipt(key)).not.toBeNull();
    expect(view.result.current.recovery.pending).toBe(false);
  });
  it("isolates account receipts and ignores completion after unmount", async () => {
    const view = setup();
    await loseResponse(view.result);
    view.unmount();
    mocks.user = { id: "other" };
    const other = setup();
    await act(async () => {});
    expect(other.result.current.recovery.pending).toBe(false);
    expect(readGenerationReceipt(key)).not.toBeNull();
  });
  it("blocks POST if the recovery store is full or malformed", async () => {
    const view = setup();
    const write = vi
      .spyOn(Object.getPrototypeOf(window.sessionStorage), "setItem")
      .mockImplementationOnce(() => {
        throw new Error("Quota exceeded");
      });
    await act(async () => {
      await expect(view.result.current.submit(request, "image", {})).rejects.toThrow(
        "Quota exceeded"
      );
    });
    write.mockRestore();
    expect(mocks.submit).not.toHaveBeenCalled();
    sessionStorage.setItem(key, JSON.stringify({ version: 1, request }));
    await act(async () => {
      await expect(view.result.current.submit(request, "image", {})).rejects.toThrow(
        "could not be read"
      );
    });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("serializes concurrent submits and ignores completion after leaving", async () => {
    const view = setup();
    let resolve!: (value: { request_id: string; status: string }) => void;
    mocks.submit.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = view.result.current.submit(request, "image", {});
    });
    await act(async () => {
      await expect(view.result.current.submit(request, "image", {})).rejects.toThrow("pending");
    });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => {
      resolve({ request_id: "accepted", status: "queued" });
      await expect(pending).rejects.toThrow();
    });
    expect(view.onRecovered).not.toHaveBeenCalled();
    expect(readGenerationReceipt(key)).toBeNull();
  });
  it("clears a definitively rejected initial command", async () => {
    const view = setup();
    mocks.submit.mockRejectedValueOnce(new ApiRequestError("INVALID", "Invalid input", 400));
    await act(async () => {
      await expect(view.result.current.submit(request, "image", {})).rejects.toThrow(
        "Invalid input"
      );
    });
    expect(readGenerationReceipt(key)).toBeNull();
    expect(view.result.current.recovery.pending).toBe(false);
  });
});
