// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { StoryCapability, StoryWorkbench } from "@/lib/story-projects-api";
import type { InteractiveFilmPublication } from "@/lib/interactive-film-api";
import { StoryProjectHeaderActions } from "./story-project-header-actions";
import type { StoryPublicationDetailsDialog } from "./story-publication-details-dialog";

type DetailsProps = Parameters<typeof StoryPublicationDetailsDialog>[0];

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
  workbench: vi.fn(),
  dialogMount: vi.fn(),
  dialogRender: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({
    user: { id: h.user },
    isCurrentAccount: (id: string) => id === h.user,
    signIn: h.signIn,
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: h.push }),
  usePathname: () => "/story-studio/projects/project-one/canvas",
}));
vi.mock("sonner", () => ({ toast: { success: h.toast, error: h.toast } }));
vi.mock("./story-project-credits-badge", () => ({ StoryProjectCreditsBadge: () => null }));
vi.mock("./story-publication-details-dialog", () => ({
  StoryPublicationDetailsDialog: (props: DetailsProps) => {
    h.dialogRender(props);
    useEffect(() => {
      h.dialogMount();
    }, []);
    return (
      <div
        data-testid="publication-details"
        data-open={props.open}
        data-project={props.projectId}
        data-workbench={props.workbench?.project.id ?? ""}
        data-loading={props.loading}
        data-error={Boolean(props.error)}
      >
        {props.open ? (
          <section role="dialog">
            <span>Publication details</span>
            <button type="button" onClick={() => props.onOpenChange(false)}>
              Close publication
            </button>
            {props.error ? (
              <button type="button" onClick={props.onRetry}>
                Retry publication
              </button>
            ) : null}
          </section>
        ) : null}
      </div>
    );
  },
}));
vi.mock("../_stores/story-project-ui-store", () => ({
  useStoryProjectUiStore: (select: (state: unknown) => unknown) =>
    select({ activeChapterId: "chapter-one", liveDraft: null, draftBarrier: h.save }),
}));
vi.mock("@/lib/story-projects-api", async (original) => ({
  ...(await original<typeof import("@/lib/story-projects-api")>()),
  getStoryWorkbench: h.workbench,
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
  h.workbench.mockImplementation(
    async () =>
      ({
        project: { id: "project-one", title: "Film", capabilities: h.capabilities },
        draft: { revision: 7 },
        video: { snapshotHash: "a".repeat(64) },
      }) as StoryWorkbench
  );
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

describe("project publication dialog entry", () => {
  it.each([
    { capabilities: ["story.read"] as StoryCapability[], role: "reader" },
    {
      capabilities: ["story.read", "story.edit", "story.generate"] as StoryCapability[],
      role: "editor",
    },
  ])(
    "lets a $role open publication details without issuing publication writes",
    async ({ capabilities }) => {
      h.capabilities = capabilities;
      h.publication = { gameId: "project-one", status: "published", rejectReason: null };
      await render();
      expect(button("Publish").disabled).toBe(false);
      await click(button("Publish"));
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(h.push).not.toHaveBeenCalled();
      expect(h.get).not.toHaveBeenCalled();
      expect(host.textContent).not.toContain("Take offline");
      expect(h.prepare).not.toHaveBeenCalled();
      expect(h.submit).not.toHaveBeenCalled();
    }
  );

  it("saves a producer's mounted canvas before opening details in place", async () => {
    await render();
    expect(h.dialogMount).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const href = window.location.href;
    await click(button("Publish"));
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.push).not.toHaveBeenCalled();
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(window.location.href).toBe(href);
    expect(h.dialogRender).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectId: "project-one",
        open: true,
        workbench: expect.objectContaining({
          project: expect.objectContaining({ id: "project-one" }),
        }),
        loading: false,
        error: null,
      })
    );
  });

  it("keeps a published project's management actions inside its dialog", async () => {
    h.publication = { gameId: "project-one", status: "published", rejectReason: null };
    await render();
    expect(button("Publish").disabled).toBe(false);
    expect(host.textContent).not.toContain("Take offline");
    await click(button("Publish"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(h.push).not.toHaveBeenCalled();
    expect(h.offline).not.toHaveBeenCalled();
    expect(h.prepare).not.toHaveBeenCalled();
  });

  it("retains the creation page and shows the draft error when saving fails", async () => {
    h.save.mockRejectedValue(Error("Resolve the draft conflict first."));
    await render();
    await click(button("Publish"));
    expect(h.push).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith("Resolve the draft conflict first.");
    expect(button("Publish").disabled).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("discards a late dialog opening after the account changes while the canvas saves", async () => {
    let finish!: () => void;
    h.save.mockImplementationOnce(() => {
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    await render();
    await click(button("Publish"));
    h.user = "bob";
    await render();
    await act(async () => finish());
    expect(h.push).not.toHaveBeenCalled();
    expect(button("Publish").disabled).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the details component mounted when closing and reopening", async () => {
    await render();
    await click(button("Publish"));
    await click(button("Close publication"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('[data-testid="publication-details"]')).not.toBeNull();
    expect(h.dialogMount).toHaveBeenCalledOnce();
    await click(button("Publish"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(h.dialogMount).toHaveBeenCalledOnce();
    expect(h.save).toHaveBeenCalledTimes(2);
  });

  it("restores keyboard focus to Publish when the dialog requests close autofocus", async () => {
    await render();
    const publishButton = button("Publish");
    await click(publishButton);
    const closeButton = button("Close publication");
    closeButton.focus();
    expect(document.activeElement).toBe(closeButton);
    await click(closeButton);
    expect(document.activeElement).toBe(document.body);
    const props = h.dialogRender.mock.lastCall?.[0] as DetailsProps;
    expect(props.onCloseAutoFocus).toBeTypeOf("function");
    const event = new Event("closeAutoFocus", { cancelable: true });
    props.onCloseAutoFocus?.(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(publishButton);
  });

  it("passes a failed workbench query into details and lets its retry recover", async () => {
    const error = new Error("Project status unavailable.");
    h.workbench.mockRejectedValueOnce(error);
    await render();
    await click(button("Publish"));
    expect(h.dialogRender).toHaveBeenLastCalledWith(expect.objectContaining({ error }));
    await click(button("Retry publication"));
    expect(h.workbench).toHaveBeenCalledTimes(2);
    expect(h.dialogRender).toHaveBeenLastCalledWith(
      expect.objectContaining({ error: null, loading: false })
    );
  });
});

it("refreshes producer capabilities while publication details remain open", async () => {
  h.capabilities = ["story.read", "story.edit"];
  await render();
  const before = h.workbench.mock.calls.length;
  vi.useFakeTimers();
  try {
    await act(async () => {
      button("Publish").click();
    });
    h.capabilities = ["story.read", "story.edit", "story.build", "story.release"];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_100);
    });
    expect(h.workbench.mock.calls.length).toBeGreaterThan(before);
    expect(h.dialogRender.mock.lastCall?.[0].workbench.project.capabilities).toContain(
      "story.release"
    );
  } finally {
    vi.useRealTimers();
  }
});
