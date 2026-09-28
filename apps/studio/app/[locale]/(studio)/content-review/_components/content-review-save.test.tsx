// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi, expect } from "vitest";
import { ContentReviewStudio } from "./content-review-studio";
const s = vi.hoisted(() => ({
  saves: [] as ((value: unknown) => void)[],
  rejects: [] as ((reason: unknown) => void)[],
  duration: null as null | ((seconds: number) => void),
  selected: null as string | null,
  post: null as null | ((body: string) => Promise<boolean>),
  open: null as null | ((id: string) => void),
  findings: [] as { description: string }[],
}));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: "u" }, requireAuth: (action: () => void) => action() }),
}));
vi.mock("@/app/_components/workspace-context", () => ({ useActiveWorkspaceId: () => "w" }));
vi.mock("@/lib/content-review-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getContentReviewRecord: async (id: string) => ({
    id,
    mediaAssetId: id,
    fileName: id,
    durationSeconds: 30,
    comments: [{ id: "original-" + id, seconds: 1, body: id, createdByUserId: "u" }],
  }),
  resultFromReviewRecord: () => ({ details: [] }),
  holdReviewCredits: async () => ({ id: "charge", credits: 10 }),
  settleReviewCredits: async () => {},
  reviewModeration: async () => ({ overview: {}, details: [], fileName: "export.xlsx" }),
  saveContentReviewRecord: () =>
    new Promise((resolve, reject) => {
      s.saves.push(resolve);
      s.rejects.push(reject);
    }),
  addContentReviewComment: vi.fn(async () => []),
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
  ContentReviewPlayer: ({ onDuration }: { onDuration: (seconds: number) => void }) => {
    s.duration = onDuration;
    return null;
  },
}));
vi.mock("@/lib/content-review-upload", () => ({
  uploadContentReviewVideo: async () => ({ url: "fixture", mediaAssetId: "asset" }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it.each(["comment", "switch", "retry"])("initial save respects %s transition", async (mode) => {
  const host = document.createElement("div");
  const root = createRoot(host);
  s.saves = [];
  s.rejects = [];
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL() {
        return "blob:fixture";
      }
      static revokeObjectURL() {}
    }
  );
  try {
    await act(async () => root.render(createElement(ContentReviewStudio)));
    const input = host.querySelector("input[type=file]")!;
    Object.defineProperty(input, "files", {
      value: [new File(["x"], "a.mp4", { type: "video/mp4" })],
    });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => s.duration!(30));
    await act(async () =>
      Array.from(host.querySelectorAll("button"))
        .find((b) => b.textContent === "submit")!
        .click()
    );
    expect(s.saves).toHaveLength(1);
    if (mode === "retry") {
      await act(async () => s.rejects[0]!(new Error("Save unavailable")));
      await act(async () => {
        void s.post!("comment");
      });
    } else if (mode === "comment") {
      await act(async () => {
        void s.post!("comment");
      });
    } else {
      await act(async () => s.open!("B"));
    }
    expect(s.saves).toHaveLength(mode === "retry" ? 2 : 1);
    await act(async () => s.saves.at(-1)!({ id: "saved-A", comments: [] }));
    expect(s.findings.map((f) => f.description)).toEqual(mode === "switch" ? ["B"] : []);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
