import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { LevelApplyDialog } from "./level-apply-dialog";
const h = vi.hoisted(() => ({ upload: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useMyCrews: () => ({ data: { founded: [], joined: [] }, isLoading: false }),
}));
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useAllMyIpCommerceIps: () => ({ data: { items: [] }, isLoading: false }),
}));
vi.mock("@/src/services/user-level-apply", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  uploadUserLevelApplyAttachment: h.upload,
}));
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
      await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
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
