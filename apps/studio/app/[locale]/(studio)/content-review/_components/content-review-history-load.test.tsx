// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi, expect } from "vitest";
import { ContentReviewStudio } from "./content-review-studio";
const s = vi.hoisted(() => ({
  loads: {} as Record<string, { resolve: (value: unknown) => void; signal: AbortSignal }>,
  src: "",
  post: null as null | ((body: string) => Promise<boolean>),
  open: null as null | ((id: string) => void),
  findings: [] as { description: string }[],
}));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: "u" }, requireAuth: vi.fn() }),
}));
vi.mock("@/app/_components/workspace-context", () => ({ useActiveWorkspaceId: () => "w" }));
vi.mock("@/lib/content-review-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getContentReviewRecord: (id: string, signal: AbortSignal) =>
    new Promise((resolve) => {
      s.loads[id] = { resolve, signal };
    }),
  resultFromReviewRecord: () => ({ details: [] }),
}));
vi.mock("./content-review-history", () => ({
  CONTENT_REVIEW_RECORDS_QUERY_KEY: "records",
  ContentReviewHistory: ({ onOpen }: { onOpen: (id: string) => void }) => {
    s.open = onOpen;
    return null;
  },
}));
vi.mock("./content-review-sidebar", () => ({
  ContentReviewSidebar: ({
    onComment,
    findings,
  }: {
    onComment: (b: string) => Promise<boolean>;
    findings: { description: string }[];
  }) => {
    s.post = onComment;
    s.findings = findings;
    return null;
  },
}));
vi.mock("./content-review-player", () => ({
  ContentReviewPlayer: ({ src }: { src: string }) => {
    s.src = src;
    return null;
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it.each(["file", "record", "current"])(
  "keeps history completion scoped to the current selection (%s)",
  async (kind) => {
    const host = document.createElement("div");
    const root = createRoot(host);
    s.loads = {};
    s.src = "";
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL() {
          return "blob:new-file";
        }
        static revokeObjectURL = vi.fn();
      }
    );
    const record = (id: string) => ({
      id,
      mediaAssetId: id,
      fileName: id,
      durationSeconds: 30,
      comments: [],
    });
    try {
      await act(async () => root.render(createElement(ContentReviewStudio)));
      await act(async () => s.open!("A"));
      if (kind === "file") {
        const input = host.querySelector("input[type=file]")!;
        Object.defineProperty(input, "files", {
          value: [new File(["x"], "new.mp4", { type: "video/mp4" })],
        });
        await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
      } else if (kind === "record") {
        await act(async () => s.open!("B"));
        await act(async () => s.loads.B.resolve(record("B")));
      }
      await act(async () => s.loads.A.resolve(record("A")));
      expect(s.src).toBe(
        kind === "file"
          ? "blob:new-file"
          : `/aurora/media/assets/${kind === "record" ? "B" : "A"}/access`
      );
      expect(s.loads.A.signal.aborted).toBe(kind !== "current");
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  }
);
