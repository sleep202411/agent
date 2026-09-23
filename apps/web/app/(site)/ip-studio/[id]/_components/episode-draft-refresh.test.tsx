import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EpisodeManager } from "./ip-studio-workbench";
import type { IpCreatorIp } from "@/src/lib/ip-commerce/api";
const s = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useCreateIpCommerceEpisode: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateIpCommerceEpisode: () => ({ mutateAsync: s.save, isPending: false }),
  useUploadIpCommerceMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteIpCommerceEpisode: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/src/env", () => ({ env: {} }));
let root: Root, host: HTMLDivElement;
const ip = (version: number, title = "Original") =>
  ({
    id: "ip",
    version,
    episodes: [
      {
        id: "episode",
        episodeNo: 1,
        title,
        summary: "Summary",
        status: "draft",
        mediaAsset: { id: "video" },
        isFreePreview: false,
      },
    ],
  }) as IpCreatorIp;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  s.save.mockReset().mockRejectedValue(new Error("Version conflict"));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function render(value: IpCreatorIp) {
  act(() => root.render(<EpisodeManager ip={value} t={(key) => key} onOpenPricing={() => {}} />));
}
async function click(text: string) {
  await act(async () =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!.click()
  );
}
const input = () =>
  document.querySelector<HTMLInputElement>('input[placeholder="epTitlePlaceholder"]')!;
function edit(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("retains an episode draft and its original version after refresh, then reopens with fresh data", async () => {
  render(ip(10));
  await click("Original");
  edit("Unsaved title");
  render(ip(11, "Remote title"));
  expect(input().value).toBe("Unsaved title");
  await click("save");
  expect(s.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: "Unsaved title", expectedVersion: 10 })
  );
  expect(input().value).toBe("Unsaved title");
  expect(document.body.textContent).toContain("Version conflict");
  await click("cancel");
  await click("Remote title");
  expect(input().value).toBe("Remote title");
  await click("save");
  expect(s.save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 11 }));
});
it("retains a new episode draft when another episode arrives during refresh", async () => {
  render({ ...ip(10), episodes: [] });
  await click("episodesPanel.create.addAction");
  edit("New draft");
  render(ip(11));
  expect(input().value).toBe("New draft");
});
