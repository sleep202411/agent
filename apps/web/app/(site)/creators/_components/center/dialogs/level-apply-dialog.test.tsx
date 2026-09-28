import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { LevelApplyDialog } from "./level-apply-dialog";
const h = vi.hoisted(() => ({
  upload: vi.fn(),
  submit: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  crews: [] as { id: string; name: string }[],
}));
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey.includes("options") ? [{ id: 13, name: "AI Producer" }] : [],
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useMyCrews: () => ({ data: { founded: [], joined: h.crews }, isLoading: false }),
}));
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useAllMyIpCommerceIps: () => ({ data: { items: [] }, isLoading: false }),
}));
vi.mock("@/src/services/user-level-apply", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  uploadUserLevelApplyAttachment: h.upload,
  submitUserLevelApply: h.submit,
}));
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView"
);
beforeAll(() =>
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  })
);
afterAll(() => {
  if (originalScrollIntoView)
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});
beforeEach(() => {
  h.crews = [];
  h.submit.mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());
it.each(["resolve", "reject", "current"] as const)(
  "upload completion belongs to its dialog opening: %s",
  async (outcome) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    let resolve!: (value: string) => void;
    let reject!: (error: Error) => void;
    h.upload.mockReturnValue(
      new Promise<string>((yes, no) => {
        resolve = yes;
        reject = no;
      })
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = async (open: boolean) => {
      await act(async () => root.render(<LevelApplyDialog open={open} onOpenChange={() => {}} />));
    };
    try {
      await render(true);
      const input = document.querySelector('input[type="file"]')!;
      Object.defineProperty(input, "files", {
        value: [new File(["evidence"], "old.pdf", { type: "application/pdf" })],
      });
      await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(h.upload).toHaveBeenCalledOnce();
      if (outcome !== "current") {
        await render(false);
        await render(true);
      }
      await act(async () => {
        if (outcome === "reject") reject(new Error("Late error"));
        else resolve("uploads/old.pdf");
      });
      if (outcome === "current") {
        expect(document.body.textContent).toContain("old.pdf");
        expect(h.success).toHaveBeenCalledOnce();
      } else {
        expect(document.body.textContent).not.toContain("old.pdf");
        expect(h.success).not.toHaveBeenCalled();
        expect(h.error).not.toHaveBeenCalled();
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  }
);

it.each(["AI Producer", "FD"])(
  "%s requires a crew and submits its name/link while leaving IP optional",
  async (entry) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    h.crews = [{ id: "crew-123", name: "Selected crew" }];
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <LevelApplyDialog
            open
            onOpenChange={() => {}}
            lockedLevelId={entry === "AI Producer" ? 13 : undefined}
          />
        )
      );
      if (entry === "FD") {
        const level = document.querySelector('[role="combobox"]')!;
        await act(async () =>
          level.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
        );
        const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
          (item) => item.textContent === "AI Producer"
        )!;
        await act(async () => option.click());
      }
      const submit = () =>
        [...document.querySelectorAll<HTMLButtonElement>("button")].find(
          (button) => button.textContent === "levels.apply.submit"
        )!;
      expect(submit().disabled).toBe(true);
      await act(async () => submit().click());
      expect(h.submit).not.toHaveBeenCalled();
      const crew = document.querySelector('[aria-label="levels.apply.crewLabel"]')!;
      expect(crew.getAttribute("aria-required")).toBe("true");
      await act(async () =>
        crew.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
      );
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (item) => item.textContent === "Selected crew"
      )!;
      await act(async () => option.click());
      expect(submit().disabled).toBe(false);
      let reject!: (error: Error) => void;
      h.submit.mockImplementationOnce(
        () =>
          new Promise((_, no) => {
            reject = no;
          })
      );
      await act(async () => {
        submit().click();
        submit().click();
      });
      expect(h.submit).toHaveBeenCalledTimes(1);
      await act(async () => reject(new Error("Temporary failure")));
      expect(submit().disabled).toBe(false);
      await act(async () => submit().click());
      expect(h.submit).toHaveBeenCalledTimes(2);
      expect(h.submit).toHaveBeenCalledWith(
        expect.objectContaining({
          levelId: 13,
          crewName: "Selected crew",
          crewLink: `${window.location.origin}/en-US/crews/crew-123`,
          ipName: "",
          ipLink: "",
        })
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  }
);

it("explains the requirement and blocks application when no crews are available", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<LevelApplyDialog open onOpenChange={() => {}} lockedLevelId={13} />)
    );
    expect(document.body.textContent).toContain("levels.apply.crewEmpty");
    const submit = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "levels.apply.submit"
    )!;
    expect(submit.disabled).toBe(true);
    expect(h.submit).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
