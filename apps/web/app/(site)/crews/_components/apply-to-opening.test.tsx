import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ApplyToOpening } from "./apply-to-opening";
import { CrewApiError } from "../_hooks/api";
const h = vi.hoisted(() => ({
  user: "alice",
  get: vi.fn(),
  post: vi.fn(),
  push: vi.fn(),
  login: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: h.user ? { id: h.user } : null }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "zh-HK",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: h.login }),
}));
vi.mock("../_hooks/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_hooks/api")>()),
  crewApi: {
    get: (...args: unknown[]) => h.get(...args),
    post: (...args: unknown[]) => h.post(...args),
  },
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.user = "alice";
  vi.clearAllMocks();
  h.get.mockResolvedValue({ items: [] });
  h.post.mockResolvedValue({ id: "application" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = () =>
  act(() => root.render(<ApplyToOpening crewId="crew" positionId="position" label="Apply" />));
it("creates only the selected application and opens the original message center", async () => {
  render();
  await act(async () => {
    host.querySelector("button")!.click();
    host.querySelector("button")!.click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post).toHaveBeenCalledWith(
    "/crews/crew/positions/position/apply",
    expect.objectContaining({ body: {} })
  );
  expect(h.push).toHaveBeenCalledWith("/zh-HK/messages?tab=recruitment&application=application");
});
it("recovers a pending application without creating another", async () => {
  h.get.mockResolvedValue({ items: [{ id: "existing" }] });
  render();
  await act(async () => host.querySelector("button")!.click());
  expect(h.post).not.toHaveBeenCalled();
  expect(h.push).toHaveBeenCalledWith("/zh-HK/messages?tab=recruitment&application=existing");
});
it("opens login before creating a private discussion", async () => {
  h.user = "";
  render();
  await act(async () => host.querySelector("button")!.click());
  expect(h.login).toHaveBeenCalledOnce();
  expect(h.get).not.toHaveBeenCalled();
});
it("does not navigate with another account's delayed application", async () => {
  let finish!: (value: unknown) => void;
  h.post.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render();
  await act(async () => host.querySelector("button")!.click());
  h.user = "bob";
  render();
  await act(async () => finish({ id: "old" }));
  expect(h.push).not.toHaveBeenCalled();
});
it("keeps the actual failure visible and allows retry", async () => {
  h.post.mockRejectedValueOnce(new Error("Position no longer accepts applications"));
  render();
  await act(async () => host.querySelector("button")!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Position no longer accepts");
  expect(h.push).not.toHaveBeenCalled();
  await act(async () => host.querySelector("button")!.click());
  expect(h.push).toHaveBeenCalledOnce();
});

it("explains missing certifications and links to Academy without creating a conversation", async () => {
  h.post.mockRejectedValueOnce(
    new CrewApiError(403, {
      code: "CREW_QUALIFICATIONS_REQUIRED",
      msg: "Certification required",
      missingSkills: ["Editing", "Sound"],
      requiredFdRank: 3,
    })
  );
  render();
  await act(async () => host.querySelector("button")!.click());
  const dialog = document.body.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("Editing, Sound");
  expect(dialog?.textContent).toContain("minimumRank");
  expect(dialog?.querySelector("a")?.getAttribute("href")).toBe("/zh-HK/courses");
  expect(h.push).not.toHaveBeenCalled();
  h.user = "bob";
  await act(async () => render());
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
});
