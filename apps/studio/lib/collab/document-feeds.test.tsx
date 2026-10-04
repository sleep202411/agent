// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api";
import { useDocumentComments } from "./use-comments";
import { useDocumentVersions } from "./use-versions";
import type { DocumentProvider } from "./document-provider";

const mocks = vi.hoisted(() => ({
  listComments: vi.fn(),
  listVersions: vi.fn(),
  create: vi.fn(),
  reply: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("./comments-api", () => ({
  listCommentThreads: mocks.listComments,
  createCommentThread: mocks.create,
  addComment: mocks.reply,
  resolveCommentThread: mocks.resolve,
}));
vi.mock("./versions-api", () => ({ listDocumentVersions: mocks.listVersions }));

for (const kind of ["comments", "versions"] as const) {
  describe(`${kind} feed ownership`, () => {
    let root: Root;
    let container: HTMLDivElement;
    let finish: Array<(items: { id: string }[]) => void>;
    let event: ((data: unknown) => void) | undefined;
    let provider: DocumentProvider;
    let retainedReply: ((threadId: string, body: string) => Promise<void>) | undefined;
    let feed: { error: string | null; refetch: () => Promise<void> };
    function Harness({ id }: { id: string | null }) {
      const comments = useDocumentComments(
        kind === "comments" ? id : null,
        kind === "comments" ? provider : null
      );
      const versions = useDocumentVersions(
        kind === "versions" ? id : null,
        kind === "versions" ? provider : null
      );
      feed = kind === "comments" ? comments : versions;
      retainedReply = comments.reply;
      const rows = kind === "comments" ? comments.threads : versions.versions;
      return <div>{rows.map((row) => row.id).join(",")}</div>;
    }
    beforeEach(() => {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      vi.clearAllMocks();
      finish = [];
      event = undefined;
      const list = kind === "comments" ? mocks.listComments : mocks.listVersions;
      list.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
      provider = {
        broadcastAppEvent: vi.fn(),
        onAppEvent: (listener: (data: unknown) => void) => {
          event = listener;
          return () => {
            event = undefined;
          };
        },
      } as unknown as DocumentProvider;
      container = document.createElement("div");
      root = createRoot(container);
    });
    afterEach(async () => {
      await act(async () => root.unmount());
    });
    it("aborts the abandoned read and retains loaded rows after a failed refresh", async () => {
      const list = kind === "comments" ? mocks.listComments : mocks.listVersions;
      await act(async () => root.render(<Harness id="a" />));
      const signal = list.mock.calls[0]?.[1] as AbortSignal;
      await act(async () => finish[0]?.([{ id: "saved" }]));
      list.mockRejectedValueOnce(new Error("offline"));
      await act(async () => event?.({ type: `${kind}_changed` }));
      expect(container.textContent).toBe("saved");
      await act(async () => event?.({ type: `${kind}_changed` }));
      const pendingSignal = list.mock.calls[2]?.[1] as AbortSignal;
      await act(async () => root.render(<Harness id="b" />));
      expect(pendingSignal.aborted).toBe(true);
      expect(signal.aborted).toBe(false);
    });
    it("exposes read failures and clears them after explicit retry", async () => {
      const list = kind === "comments" ? mocks.listComments : mocks.listVersions;
      list.mockRejectedValueOnce(new Error("Document service unavailable"));
      await act(async () => root.render(<Harness id="a" />));
      expect(feed.error).toBe("Document service unavailable");
      list.mockResolvedValueOnce([{ id: "recovered" }]);
      await act(async () => feed.refetch());
      expect(feed.error).toBeNull();
      expect(container.textContent).toBe("recovered");
    });
    it("clears previously loaded entries when access is revoked", async () => {
      const list = kind === "comments" ? mocks.listComments : mocks.listVersions;
      await act(async () => root.render(<Harness id="a" />));
      await act(async () => finish[0]?.([{ id: "private" }]));
      list.mockRejectedValueOnce(new ApiRequestError("denied", "Permission revoked", 403));
      await act(async () => event?.({ type: `${kind}_changed` }));
      expect(container.textContent).toBe("");
      expect(feed.error).toBe("Permission revoked");
    });
    if (kind === "comments")
      it("rejects retained replies after document replacement", async () => {
        await act(async () => root.render(<Harness id="a" />));
        const oldReply = retainedReply;
        await act(async () => root.render(<Harness id="b" />));
        await act(async () => oldReply?.("thread-a", "old reply"));
        expect(mocks.reply).not.toHaveBeenCalled();
        expect(provider.broadcastAppEvent).not.toHaveBeenCalled();
      });
    it("does not overwrite the replacement document with a late response", async () => {
      await act(async () => root.render(<Harness id="a" />));
      await act(async () => root.render(<Harness id="b" />));
      await act(async () => finish[1]?.([{ id: "new" }]));
      await act(async () => finish[0]?.([{ id: "old" }]));
      expect(container.textContent).toBe("new");
    });
    it("keeps the newer peer refresh when requests finish out of order", async () => {
      await act(async () => root.render(<Harness id="a" />));
      await act(async () => event?.({ type: `${kind}_changed` }));
      await act(async () => finish[1]?.([{ id: "new" }]));
      await act(async () => finish[0]?.([{ id: "old" }]));
      expect(container.textContent).toBe("new");
    });
    it("clears the previous document's rows while its replacement loads", async () => {
      await act(async () => root.render(<Harness id="a" />));
      await act(async () => finish[0]?.([{ id: "old" }]));
      await act(async () => root.render(<Harness id="b" />));
      expect(container.textContent).toBe("");
    });
  });
}
