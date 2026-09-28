// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi, expect } from "vitest";
import { ContentReviewStudio } from "./content-review-studio";
const s = vi.hoisted(() => ({
  resolve: null as null | ((value: unknown) => void),
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
  getContentReviewRecord: async (id: string) => ({
    id,
    mediaAssetId: id,
    fileName: id,
    durationSeconds: 30,
    comments: [{ id: "original-" + id, seconds: 1, body: id, createdByUserId: "u" }],
  }),
  resultFromReviewRecord: () => ({ details: [] }),
  addContentReviewComment: () =>
    new Promise((r) => {
      s.resolve = r;
    }),
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
vi.mock("./content-review-player", () => ({ ContentReviewPlayer: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it.each([true, false])(
  "keeps comment completion scoped to its record (switch=%s)",
  async (switchRecord) => {
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(createElement(ContentReviewStudio)));
      await act(async () => s.open!("A"));
      let pending!: Promise<boolean>;
      await act(async () => {
        pending = s.post!("new A");
      });
      if (switchRecord) await act(async () => s.open!("B"));
      await act(async () => {
        s.resolve!([{ id: "new-A", seconds: 2, body: "new A", createdByUserId: "u" }]);
        await pending;
      });
      expect(s.findings.map((f) => f.description)).toEqual(switchRecord ? ["B"] : ["new A"]);
    } finally {
      await act(async () => root.unmount());
    }
  }
);
