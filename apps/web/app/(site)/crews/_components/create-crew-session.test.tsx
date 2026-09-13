import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreateCrewDialog } from "./create-crew-dialog";
const state = vi.hoisted(() => ({
  account: "alice",
  query: vi.fn(),
  save: vi.fn(),
  upload: vi.fn(),
  close: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => {
    state.query(options);
    return { data: { eligible: true }, isPending: false, isFetching: false, isError: false };
  },
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.account }, isLoading: false }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.navigate }) }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn(), captureException: vi.fn() } }));
vi.mock("@/src/services/user", () => ({ uploadBanner: state.upload }));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  crewApi: { get: vi.fn() },
  CrewApiError: class extends Error {},
  useCreateCrew: () => ({ mutate: state.save, isPending: false }),
  useUpdateCrew: () => ({ mutate: state.save, isPending: false }),
}));
vi.mock("./crew-eligibility-notice", () => ({ CrewEligibilityNotice: () => null }));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogContent: Part,
    DialogBody: Part,
    DialogFooter: Part,
    DialogTitle: Part,
    DialogDescription: Part,
    DialogHero: () => null,
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  state.account = "alice";
  state.upload.mockResolvedValue("logo.png");
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
async function render(open = true, id: string | null = "crew") {
  await act(async () =>
    root.render(
      <CreateCrewDialog
        open={open}
        onOpenChange={state.close}
        initial={id ? { id, name: "Original", description: "Details", logo: "logo.png" } : null}
      />
    )
  );
}
async function save() {
  await act(async () => {
    const b = [...container.querySelectorAll("button")].at(-1)!;
    b.click();
    b.click();
  });
}
async function upload() {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["x"], "logo.png", { type: "image/png" })],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
it("uses separate eligibility keys for each account", async () => {
  await render(true, null);
  const a = state.query.mock.calls.at(-1)?.[0].queryKey;
  state.account = "bob";
  await render(true, null);
  expect(state.query.mock.calls.at(-1)?.[0].queryKey).not.toEqual(a);
});
it("blocks duplicate saves and unlocks retry after a failure", async () => {
  await render();
  await save();
  expect(state.save).toHaveBeenCalledTimes(1);
  const callbacks = state.save.mock.calls[0]?.[1];
  await act(async () => {
    callbacks.onError(new Error("Try again"));
    callbacks.onSettled?.();
  });
  await save();
  expect(state.save).toHaveBeenCalledTimes(2);
});
it.each(["close", "account", "crew"])(
  "ignores old save callbacks after %s changes",
  async (change) => {
    await render();
    await save();
    const callbacks = state.save.mock.calls[0]?.[1];
    if (change === "close") await render(false);
    if (change === "account") state.account = "bob";
    await render(true, change === "crew" ? "next" : "crew");
    await act(async () => {
      callbacks.onSuccess({ id: "crew" });
      callbacks.onSettled?.();
    });
    expect(state.close).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
    await save();
    expect(state.save).toHaveBeenCalledTimes(2);
  }
);
it("blocks overlapping logo and save requests and ignores an ended upload", async () => {
  let resolve!: (path: string) => void;
  state.upload.mockReturnValueOnce(
    new Promise<string>((yes) => {
      resolve = yes;
    })
  );
  await render();
  await upload();
  await upload();
  await save();
  expect(state.upload).toHaveBeenCalledTimes(1);
  expect(state.save).not.toHaveBeenCalled();
  await render(false);
  await render();
  await act(async () => resolve("old-logo.png"));
  expect(container.querySelector("img")?.src).not.toContain("old-logo.png");
});
it("does not navigate from a creation completed after closure", async () => {
  await render(true, null);
  await act(async () => {
    const name = container.querySelector<HTMLInputElement>('input:not([type="file"])')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      name,
      "New Crew"
    );
    name.dispatchEvent(new Event("input", { bubbles: true }));
    const description = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      description,
      "Description"
    );
    description.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await upload();
  await save();
  expect(state.save).toHaveBeenCalledTimes(1);
  const callbacks = state.save.mock.calls[0]?.[1];
  await render(false, null);
  await render(true, null);
  await act(async () => {
    callbacks.onSuccess({ id: "created" });
    callbacks.onSettled?.();
  });
  expect(state.navigate).not.toHaveBeenCalled();
  expect(state.close).not.toHaveBeenCalled();
});
