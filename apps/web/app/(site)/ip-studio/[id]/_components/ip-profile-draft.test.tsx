import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IpProfileEditDialog } from "./ip-studio-workbench";
import type { IpCreatorIp } from "@/src/lib/ip-commerce/api";
const s = vi.hoisted(() => ({ save: vi.fn(), error: vi.fn(), close: vi.fn() }));
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useUpdateIpCommerceIpProfile: () => ({ mutateAsync: s.save, isPending: false }),
  useIpCommerceTaxonomyTerms: () => ({ data: { items: [] }, isLoading: false }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: s.error } }));
vi.mock("@/src/env", () => ({ env: {} }));
let root: Root, host: HTMLDivElement;
const ip = (version: number, title = "Original") => ({
  id: "ip", version, title, summary: "Summary", description: "",
  listingVisibility: "public", ageRating: "all", genreCodes: ["drama"],
}) as IpCreatorIp;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  s.save.mockReset().mockResolvedValue({ ip: ip(11) });
  s.close.mockClear();
  s.error.mockClear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
function render(value: IpCreatorIp, open = true) {
  act(() => root.render(<IpProfileEditDialog ip={value} open={open} onOpenChange={s.close} />));
}
const input = () => document.querySelector<HTMLInputElement>('input[placeholder="fieldNamePlaceholder"]')!;
function edit(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function save() {
  await act(async () => [...document.querySelectorAll("button")].find(b => b.textContent === "profileEdit.save")!.click());
}
it("keeps the draft and original concurrency version after a background refresh", async () => {
  render(ip(10));
  edit("My unsaved title");
  render(ip(11, "Remote title"));
  expect(input().value).toBe("My unsaved title");
  s.save.mockRejectedValueOnce(new Error("Version conflict"));
  await save();
  expect(s.save).toHaveBeenCalledWith(expect.objectContaining({ title: "My unsaved title", expectedVersion: 10 }));
  expect(s.error).toHaveBeenCalledWith("Version conflict");
  expect(s.close).not.toHaveBeenCalled();
});
it("starts from current values and version when reopened", async () => {
  render(ip(10));
  edit("Discarded draft");
  render(ip(11, "Remote title"), false);
  render(ip(11, "Remote title"));
  expect(input().value).toBe("Remote title");
  edit("Fresh edit");
  await save();
  expect(s.save).toHaveBeenCalledWith(expect.objectContaining({ title: "Fresh edit", expectedVersion: 11 }));
  expect(s.close).toHaveBeenCalledWith(false);
});
