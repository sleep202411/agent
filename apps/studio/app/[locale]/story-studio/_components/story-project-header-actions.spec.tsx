// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { StoryCapability, StoryWorkbench } from "@/lib/story-projects-api";
import type { InteractiveFilmPublication } from "@/lib/interactive-film-api";
import { StoryProjectHeaderActions } from "./story-project-header-actions";

const h = vi.hoisted(() => ({
  user: "alice",
  capabilities: [] as StoryCapability[],
  publication: null as InteractiveFilmPublication | null,
  get: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
  offline: vi.fn(),
  save: vi.fn(),
  signIn: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({
    user: { id: h.user },
    isCurrentAccount: (id: string) => id === h.user,
    signIn: h.signIn,
  }),
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("sonner", () => ({ toast: { success: h.toast, error: h.toast } }));
vi.mock("./story-project-credits-badge", () => ({ StoryProjectCreditsBadge: () => null }));
vi.mock("../_stores/story-project-ui-store", () => ({
  useStoryProjectUiStore: (select: (state: unknown) => unknown) =>
    select({ activeChapterId: "chapter-one", liveDraft: null, draftBarrier: h.save }),
}));
vi.mock("@/lib/story-projects-api", async (original) => ({
  ...(await original<typeof import("@/lib/story-projects-api")>()),
  getStoryWorkbench: async () =>
    ({
      project: { id: "project-one", title: "Film", capabilities: h.capabilities },
      draft: { revision: 7 },
      video: { snapshotHash: "a".repeat(64) },
    }) as StoryWorkbench,
}));
vi.mock("@/lib/interactive-film-api", async (original) => ({
  ...(await original<typeof import("@/lib/interactive-film-api")>()),
  getInteractiveFilmPublication: h.get,
  prepareInteractiveFilmRelease: h.prepare,
  submitInteractiveFilmRelease: h.submit,
  offlineInteractiveFilm: h.offline,
}));
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  h.user = "alice";
  h.publication = null;
  h.capabilities = ["story.read", "story.edit", "story.build", "story.release"];
  h.get.mockImplementation(async () => h.publication);
  h.prepare.mockResolvedValue({ gameId: "project-one", status: "draft" });
  h.submit.mockImplementation(async () => {
    h.publication = { gameId: "project-one", status: "reviewing", rejectReason: null };
    return h.publication;
  });
  h.offline.mockImplementation(async () => {
    h.publication = { gameId: "project-one", status: "offline", rejectReason: null };
    return h.publication;
  });
  h.save.mockImplementation(async (submit: (revision: number) => Promise<unknown>) => submit(7));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en-US" messages={messages}>
          <TooltipProvider delayDuration={0}>
            <StoryProjectHeaderActions projectId="project-one" />
          </TooltipProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
function button(text: string, scope: ParentNode = document): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === text
  );
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}
async function click(target: HTMLButtonElement) {
  await act(async () => target.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("project publication permissions in the existing header", () => {
  it.each([
    { capabilities: ["story.read"] as StoryCapability[], role: "reader" },
    {
      capabilities: ["story.read", "story.edit", "story.generate"] as StoryCapability[],
      role: "editor",
    },
  ])(
    "lets a $role read status while retaining publishing restrictions",
    async ({ capabilities }) => {
      h.capabilities = capabilities;
      h.publication = { gameId: "project-one", status: "published", rejectReason: null };
      await render();
      expect(host.textContent).toContain("Published");
      expect(h.get).toHaveBeenCalledOnce();
      expect(button("Published").disabled).toBe(true);
      expect(button("Published").parentElement?.getAttribute("aria-label")).toContain(
        "Publishing access is required"
      );
      expect(host.textContent).not.toContain("Take offline");
      expect(h.prepare).not.toHaveBeenCalled();
      expect(h.submit).not.toHaveBeenCalled();
    }
  );

  it("allows a producer to submit through the original modal and saved canvas snapshot", async () => {
    await render();
    await click(button("Submit for review"));
    expect(h.push).not.toHaveBeenCalled();
    await click(button("Submit for review", document.querySelector('[role="dialog"]')!));
    expect(h.get).toHaveBeenCalledTimes(3);
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.prepare).toHaveBeenCalledWith(
      "project-one",
      { expectedDraftRevision: 7, expectedVideoSnapshotHash: "a".repeat(64) },
      expect.any(AbortSignal)
    );
    expect(h.submit).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Version submitted");
  });

  it("requires a published producer to take the film offline before submitting again", async () => {
    h.publication = { gameId: "project-one", status: "published", rejectReason: null };
    await render();
    expect(button("Published").disabled).toBe(true);
    expect(button("Published").parentElement?.getAttribute("aria-label")).toContain(
      "Take the project offline"
    );
    await click(button("Take offline"));
    await click(button("Take offline", document.querySelector('[role="dialog"]')!));
    expect(h.offline).toHaveBeenCalledWith("project-one", expect.any(AbortSignal));
    expect(button("Submit update").disabled).toBe(false);
    expect(h.prepare).not.toHaveBeenCalled();
  });

  it("explains upstream service authorization failure without blaming the producer's role", async () => {
    h.get.mockRejectedValue(
      Object.assign(Error("Upstream service credential rejected"), {
        status: 502,
        code: "STORY_PUBLICATION_UPSTREAM_FAILED",
      })
    );
    await render();
    expect(host.textContent).toContain("Publication service error");
    const submit = button("Submit for review");
    expect(submit.disabled).toBe(true);
    expect(submit.parentElement?.getAttribute("aria-label")).toContain(
      "The publication service could not verify the status"
    );
    expect(submit.parentElement?.getAttribute("aria-label")).toContain(
      "Upstream service credential rejected"
    );
    expect(submit.parentElement?.getAttribute("aria-label")).not.toContain(
      "Publishing access is required"
    );
  });

  it("aborts the previous account's status read and discards its late status", async () => {
    let finish!: (value: InteractiveFilmPublication) => void;
    h.get.mockImplementationOnce(() => {
      h.get.mockResolvedValue({ gameId: "project-one", status: "offline", rejectReason: null });
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await render();
    const signal = h.get.mock.calls[0]![1] as AbortSignal;
    h.user = "bob";
    await render();
    expect(signal.aborted).toBe(true);
    await act(async () =>
      finish({ gameId: "project-one", status: "published", rejectReason: null })
    );
    expect(host.textContent).toContain("Offline");
    expect(host.textContent).not.toContain("Published");
  });
});
