// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { IpReleaseLinks } from "./ip-release-links";
import { api } from "@/src/lib/api";
const state = vi.hoisted(() => ({ id: "owner" }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: state.id } }) }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/src/lib/api", () => ({ api: { get: vi.fn(), put: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const saved = { links: [{ label: "Platform", url: "https://example.com/title" }], version: 3 };
beforeEach(() => {
  state.id = "owner";
  container = document.createElement("div");
  root = createRoot(container);
  vi.mocked(api.get).mockResolvedValue(saved);
});
afterEach(() => {
  act(() => root.unmount());
  vi.resetAllMocks();
});
const render = (editable = false) =>
  act(async () => root.render(<IpReleaseLinks ipId="ip" editable={editable} />));
it("shows configured public release links with safe new-tab behavior", async () => {
  await render();
  const link = container.querySelector("a")!;
  expect(link.href).toBe(saved.links[0]!.url);
  expect(link.rel).toContain("noopener");
  expect(link.textContent).toContain("Platform");
});
it("retains failed edits and prevents duplicate saves", async () => {
  await render(true);
  let reject!: (reason: Error) => void;
  vi.mocked(api.put).mockImplementation(
    () =>
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      })
  );
  act(() => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(api.put).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("Refresh and try again")));
  expect(container.textContent).toContain("Refresh and try again");
  expect(container.querySelector("input")!.value).toBe("Platform");
  expect(container.querySelector('button[type="submit"]')!.hasAttribute("disabled")).toBe(false);
});
it("aborts old reads and suppresses their result after account change", async () => {
  let finish!: (value: typeof saved) => void;
  let signal!: AbortSignal;
  vi.mocked(api.get).mockImplementationOnce((_path, options) => {
    signal = options!.signal as AbortSignal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await render();
  state.id = "replacement";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () =>
    finish({ links: [{ label: "Old account", url: "https://example.com/old" }], version: 4 })
  );
  expect(container.textContent).not.toContain("Old account");
});
