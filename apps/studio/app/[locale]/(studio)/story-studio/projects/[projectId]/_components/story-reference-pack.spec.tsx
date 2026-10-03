// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { StoryReferencePack } from "./story-reference-pack";
import type { StoryWorkbench } from "@/lib/story-projects-api";
const state = vi.hoisted(() => ({
  user: "a",
  upload: vi.fn(),
  attach: vi.fn(),
  review: vi.fn(),
  approve: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: state.user } }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/media-upload", () => ({ uploadFileViaSignedUrl: state.upload }));
vi.mock("@/lib/story-projects-api", () => ({
  createStoryReferenceVersion: state.attach,
  reviewStoryReferenceVersion: state.review,
  approveStoryReferenceVersion: state.approve,
  createStoryReferenceSlots: vi.fn(),
  updateStoryReferenceSlot: vi.fn(),
  storyApiErrorMessage: (e: Error) => e.message,
}));
vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <section>{children}</section> : null,
    DialogContent: Part,
    DialogDescription: Part,
    DialogTitle: Part,
    DialogHeader: Part,
    DialogFooter: Part,
  };
});
let host: HTMLDivElement, root: Root, workbench: StoryWorkbench, project: string;
const render = () =>
  act(async () =>
    root.render(
      <StoryReferencePack
        projectId={project}
        workspaceId="team"
        workbench={workbench}
        onRefresh={state.refresh}
        apiConnected
      />
    )
  );
const click = (text: string, last = false) =>
  act(async () => {
    const buttons = [...host.querySelectorAll("button")].filter((b) =>
      b.textContent?.includes(text)
    );
    const b = last ? buttons.at(-1) : buttons[0];
    if (!b) throw Error(text);
    b.click();
  });
async function upload() {
  await click("Hero");
  await act(async () => {
    const input = host.querySelector('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      value: [new File(["x"], "x.png", { type: "image/png" })],
      configurable: true,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function deferred<T>() {
  let resolve!: (x: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { resolve, promise };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.user = "a";
  project = "p";
  state.refresh.mockResolvedValue(undefined);
  state.attach.mockResolvedValue({});
  state.approve.mockResolvedValue({});
  workbench = {
    project: { capabilities: ["story.generate", "story.review"] },
    references: [
      {
        id: "s",
        projectId: "p",
        key: "hero",
        kind: "character",
        label: "Hero",
        description: "",
        required: true,
        rank: 10,
        version: 2,
        status: "candidate",
        approvedVersionId: null,
        versions: [
          {
            id: "v",
            number: 1,
            source: "upload",
            reviewRevision: 3,
            asset: { id: "asset", kind: "image" },
            variantId: "variant",
          },
        ],
      },
    ],
  } as unknown as StoryWorkbench;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it.each(["account", "project", "permissions", "unmount"])(
  "stops upload attachment on %s departure",
  async (change) => {
    const pending = deferred<object>();
    state.upload.mockReturnValue(pending.promise);
    await render();
    await upload();
    const signal = state.upload.mock.calls[0][1].signal as AbortSignal;
    if (change === "account") state.user = "b";
    if (change === "project") project = "q";
    if (change === "permissions")
      workbench = { ...workbench, project: { ...workbench.project, capabilities: [] } };
    if (change === "unmount") await act(async () => root.render(null));
    else await render();
    expect(signal.aborted).toBe(true);
    await act(async () =>
      pending.resolve({ mediaAssetId: "uploaded", variantId: "uv", url: "/preview" })
    );
    expect(state.attach).not.toHaveBeenCalled();
    expect(state.refresh).not.toHaveBeenCalled();
  }
);
it("retains a confirmed upload for attachment retry without re-uploading", async () => {
  state.upload.mockResolvedValue({ mediaAssetId: "uploaded", variantId: "uv", url: "/preview" });
  state.attach.mockRejectedValueOnce(new Error("Attach unavailable"));
  await render();
  await upload();
  expect(host.textContent).toContain("Attach unavailable");
  await click("assets.retryAttach");
  expect(state.upload).toHaveBeenCalledOnce();
  expect(state.attach).toHaveBeenCalledTimes(2);
  expect(state.refresh).toHaveBeenCalledOnce();
});
it("stops approval after a late review response from a retired account", async () => {
  const pending = deferred<object>();
  state.review.mockReturnValue(pending.promise);
  await render();
  await click("Hero");
  await click("actions.review");
  await click("actions.review", true);
  expect(state.review).toHaveBeenCalledOnce();
  const signal = state.review.mock.calls[0][4] as AbortSignal;
  state.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve({ review: { id: "r" } }));
  expect(state.approve).not.toHaveBeenCalled();
  expect(state.refresh).not.toHaveBeenCalled();
});
it("completes the current review and approval with the same signal", async () => {
  state.review.mockResolvedValue({ review: { id: "r" } });
  await render();
  await click("Hero");
  await click("actions.review");
  await click("actions.review", true);
  expect(state.approve).toHaveBeenCalledWith(
    "p",
    "s",
    { expectedSlotVersion: 2, referenceVersionId: "v", approveReviewId: "r" },
    state.review.mock.calls[0][4]
  );
  expect(state.refresh).toHaveBeenCalledOnce();
});
