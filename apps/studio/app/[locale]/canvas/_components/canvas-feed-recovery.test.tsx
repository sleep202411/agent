import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommentsProvider } from "./canvas-comments";
import { CanvasHistory } from "./canvas-history";
import { useComments } from "@/components/canvas/authoring/comments-context";
const s = vi.hoisted(() => ({
  error: "Read unavailable" as string | null,
  loading: false,
  retry: vi.fn(),
  create: vi.fn(),
  reply: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/collab/use-comments", () => ({
  useDocumentComments: () => ({
    threads: [],
    loading: s.loading,
    error: s.error,
    refetch: s.retry,
    createThread: s.create,
    reply: s.reply,
    resolve: s.resolve,
  }),
}));
vi.mock("@/lib/collab/use-versions", () => ({
  useDocumentVersions: () => ({
    versions: [],
    loading: s.loading,
    error: s.error,
    refetch: s.retry,
  }),
}));
vi.mock("@/lib/users-api", () => ({ useUsersByIds: () => new Map() }));
vi.mock("@/components/canvas/authoring/node-toolbar", () => ({ FLOATING_PANEL: "" }));
let root: Root, host: HTMLDivElement;
function Open() {
  const ctx = useComments();
  return <button onClick={() => ctx.toggle("node")}>open</button>;
}
async function render() {
  await act(async () =>
    root.render(
      <CommentsProvider documentId="doc" provider={null}>
        <Open />
      </CommentsProvider>
    )
  );
}
async function click(label: string) {
  await act(async () =>
    host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click()
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  s.error = "Read unavailable";
  s.loading = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("shows failed activity reads with retry instead of an empty activity claim", async () => {
  await act(async () =>
    root.render(<CanvasHistory documentId="doc" provider={null} onClose={() => {}} />)
  );
  expect(host.textContent).toContain("Read unavailable");
  expect(host.textContent).not.toContain("activity.empty");
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "retry")!
      .click()
  );
  expect(s.retry).toHaveBeenCalledTimes(1);
});
it("blocks a new comment after a failed read and preserves its draft when retrying", async () => {
  await render();
  await act(async () => host.querySelector("button")!.click());
  const input = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "Keep my note"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelector<HTMLButtonElement>('[aria-label="comments.send"]')!.disabled).toBe(
    true
  );
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "retry")!
      .click()
  );
  expect(s.retry).toHaveBeenCalledTimes(1);
  s.error = null;
  await render();
  expect(input.value).toBe("Keep my note");
  s.create.mockRejectedValueOnce(new Error("Write unavailable"));
  await click("comments.send");
  expect(host.textContent).toContain("Write unavailable");
  expect(input.value).toBe("Keep my note");
  s.create.mockResolvedValueOnce(undefined);
  await click("comments.send");
  expect(input.value).toBe("");
});
