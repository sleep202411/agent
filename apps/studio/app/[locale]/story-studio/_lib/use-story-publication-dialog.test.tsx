// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStoryPublicationDialog } from "./use-story-publication-dialog";

const h = vi.hoisted(() => ({
  userId: "alice" as string | null,
  projectId: "project-one",
  barrier: null as null | ((submit: (revision: number) => Promise<unknown>) => Promise<unknown>),
  beforeOpen: undefined as undefined | (() => Promise<void>),
  error: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({
    user: h.userId == null ? null : { id: h.userId },
    isCurrentAccount: (id: string) => h.userId === id,
  }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: h.error } }));
vi.mock("../_stores/story-project-ui-store", () => ({
  useStoryProjectUiStore: (select: (state: unknown) => unknown) =>
    select({ draftBarrier: h.barrier }),
}));

let host: HTMLDivElement, root: Root, hook: ReturnType<typeof useStoryPublicationDialog>;
function Harness() {
  const value = useStoryPublicationDialog(h.projectId, h.beforeOpen);
  useLayoutEffect(() => {
    hook = value;
  });
  return <span>{String(value.open)}</span>;
}
async function render() {
  await act(async () => root.render(<Harness />));
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.userId = "alice";
  h.projectId = "project-one";
  h.barrier = null;
  h.beforeOpen = undefined;
  window.history.replaceState(
    null,
    "",
    "/en-US/story-studio/projects/project-one/canvas?chapter=chapter-two&focus=clip%3Ascene-two"
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("publication dialog entry", () => {
  it("saves preview appearance before the canvas barrier and keeps failed saves out of review", async () => {
    const order: string[] = [];
    h.beforeOpen = async () => {
      order.push("appearance");
      throw new Error("Appearance version conflict");
    };
    h.barrier = async (submit) => {
      order.push("canvas");
      return submit(7);
    };
    await render();
    await act(async () => hook.openPublication());
    expect(order).toEqual(["appearance"]);
    expect(hook.open).toBe(false);
    expect(h.error).toHaveBeenCalledWith("Appearance version conflict");
    h.beforeOpen = async () => {
      order.push("appearance");
    };
    await render();
    await act(async () => hook.openPublication());
    expect(order).toEqual(["appearance", "appearance", "canvas"]);
    expect(hook.open).toBe(true);
  });
  it("waits for the canvas save before opening and retains the full canvas URL", async () => {
    const saved = deferred();
    h.barrier = async (submit) => {
      await saved.promise;
      return submit(7);
    };
    await render();
    const href = window.location.href;
    let opening!: Promise<void>;
    await act(async () => {
      opening = hook.openPublication();
    });
    expect(hook.open).toBe(false);
    expect(hook.pending).toBe(true);
    expect(window.location.href).toBe(href);
    await act(async () => {
      saved.resolve();
      await opening;
    });
    expect(hook.open).toBe(true);
    expect(hook.pending).toBe(false);
    expect(window.location.href).toBe(href);
  });

  it("keeps the dialog closed and shows the specific canvas save error", async () => {
    h.barrier = async () => {
      throw new Error("Resolve the draft conflict first.");
    };
    await render();
    await act(async () => hook.openPublication());
    expect(hook.open).toBe(false);
    expect(hook.pending).toBe(false);
    expect(h.error).toHaveBeenCalledWith("Resolve the draft conflict first.");
  });

  it.each(["unmount", "account", "project"])(
    "suppresses a late open after %s while saving",
    async (change) => {
      const saved = deferred();
      h.barrier = async (submit) => {
        await saved.promise;
        return submit(7);
      };
      await render();
      let opening!: Promise<void>;
      await act(async () => {
        opening = hook.openPublication();
      });
      if (change === "unmount") await act(async () => root.render(null));
      else {
        if (change === "account") h.userId = "bob";
        else h.projectId = "project-two";
        await render();
        expect(hook.pending).toBe(false);
      }
      await act(async () => {
        saved.resolve();
        await opening;
      });
      expect(hook.open).toBe(false);
      expect(h.error).not.toHaveBeenCalled();
    }
  );

  it("ignores repeated clicks while the canvas save is pending", async () => {
    const saved = deferred();
    const barrier = vi.fn(async (submit: (revision: number) => Promise<unknown>) => {
      await saved.promise;
      return submit(7);
    });
    h.barrier = barrier;
    await render();
    let opening!: Promise<void>;
    await act(async () => {
      opening = hook.openPublication();
      void hook.openPublication();
    });
    expect(barrier).toHaveBeenCalledOnce();
    await act(async () => {
      saved.resolve();
      await opening;
    });
    expect(hook.open).toBe(true);
  });

  it("closes and reopens in place without replaying an already open entry", async () => {
    const barrier = vi.fn(async (submit: (revision: number) => Promise<unknown>) => submit(7));
    h.barrier = barrier;
    await render();
    const href = window.location.href;
    await act(async () => hook.openPublication());
    await act(async () => hook.openPublication());
    expect(barrier).toHaveBeenCalledOnce();
    await act(async () => hook.closePublication());
    expect(hook.open).toBe(false);
    await act(async () => hook.openPublication());
    expect(hook.open).toBe(true);
    expect(barrier).toHaveBeenCalledTimes(2);
    expect(window.location.href).toBe(href);
  });

  it.each(["account", "project"])(
    "keeps publication closed after switching the %s away and back",
    async (change) => {
      await render();
      await act(async () => hook.openPublication());
      expect(hook.open).toBe(true);
      if (change === "account") h.userId = "bob";
      else h.projectId = "project-two";
      await render();
      expect(hook.open).toBe(false);
      if (change === "account") h.userId = "alice";
      else h.projectId = "project-one";
      await render();
      expect(hook.open).toBe(false);
      await act(async () => hook.openPublication());
      expect(hook.open).toBe(true);
    }
  );

  it("a closed save cannot reopen the dialog or settle a newer opening", async () => {
    const first = deferred();
    const second = deferred();
    const barrier = vi
      .fn()
      .mockImplementationOnce(async (submit: (revision: number) => Promise<unknown>) => {
        await first.promise;
        return submit(7);
      })
      .mockImplementationOnce(async (submit: (revision: number) => Promise<unknown>) => {
        await second.promise;
        return submit(8);
      });
    h.barrier = barrier;
    await render();
    let firstOpening!: Promise<void>, secondOpening!: Promise<void>;
    await act(async () => {
      firstOpening = hook.openPublication();
    });
    await act(async () => hook.closePublication());
    await act(async () => {
      secondOpening = hook.openPublication();
    });
    await act(async () => {
      first.resolve();
      await firstOpening;
    });
    expect(hook.open).toBe(false);
    expect(hook.pending).toBe(true);
    await act(async () => {
      second.resolve();
      await secondOpening;
    });
    expect(hook.open).toBe(true);
    expect(hook.pending).toBe(false);
  });

  it("does not open or save without an authenticated account", async () => {
    h.userId = null;
    h.barrier = vi.fn();
    await render();
    await act(async () => hook.openPublication());
    expect(hook.open).toBe(false);
    expect(hook.pending).toBe(false);
    expect(h.barrier).not.toHaveBeenCalled();
  });
});
