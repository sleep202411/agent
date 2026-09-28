import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EpisodePriceEditor } from "./ip-studio-workbench";
import type { IpCreatorIp } from "@/src/lib/ip-commerce/api";
const s = vi.hoisted(() => ({
  price: vi.fn(),
  episode: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useUpsertIpCommercePriceRule: () => ({ mutateAsync: s.price, isPending: false }),
  useUpdateIpCommerceEpisode: () => ({ mutateAsync: s.episode, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: s.success, error: s.error } }));
vi.mock("@/src/env", () => ({ env: {} }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  root = createRoot(host);
  s.price.mockReset().mockResolvedValue({ ip: { version: 12 } });
  s.episode.mockReset().mockResolvedValue({ ip: { version: 11 } });
  s.error.mockClear();
  s.success.mockClear();
});
afterEach(() => act(() => root.unmount()));
function render(free: boolean, priced: boolean) {
  act(() =>
    root.render(
      <EpisodePriceEditor
        ip={{ id: "ip", version: 10 } as IpCreatorIp}
        episode={
          {
            id: "ep",
            title: "Episode",
            isFreePreview: free,
            price: priced ? { amount: "20" } : null,
          } as NonNullable<IpCreatorIp["episodes"]>[number]
        }
        displayNumber={1}
        t={(key: string) => key}
      />
    )
  );
}
async function click(suffix: string) {
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === `pricingPanel.form.${suffix}`)!
      .click()
  );
}
it("uses the price-removal version when enabling free preview", async () => {
  render(false, true);
  await click("freePreview");
  expect(s.price).toHaveBeenCalledWith(
    expect.objectContaining({ expectedVersion: 10, status: "disabled" })
  );
  expect(s.episode).toHaveBeenCalledWith(
    expect.objectContaining({ expectedVersion: 12, isFreePreview: true })
  );
});
it("uses the episode-update version when pricing a free preview", async () => {
  render(true, false);
  await click("setPrice");
  act(() => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "20");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("save");
  expect(s.episode).toHaveBeenCalledWith(
    expect.objectContaining({ expectedVersion: 10, isFreePreview: false })
  );
  expect(s.price).toHaveBeenCalledWith(
    expect.objectContaining({ expectedVersion: 11, status: "active" })
  );
});
it("uses the price-removal version when clearing a priced preview", async () => {
  render(true, true);
  await click("clear");
  expect(s.episode).toHaveBeenCalledWith(
    expect.objectContaining({ expectedVersion: 12, isFreePreview: false })
  );
});
it("stops if the first step fails", async () => {
  s.price.mockRejectedValueOnce(new Error("Conflict"));
  render(false, true);
  await click("freePreview");
  expect(s.episode).not.toHaveBeenCalled();
  expect(s.error).toHaveBeenCalledWith("Conflict");
});

it("keeps the initial version when no price-removal step is needed", async () => {
  render(false, false);
  await click("freePreview");
  expect(s.price).not.toHaveBeenCalled();
  expect(s.episode).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 10 }));
});

it("surfaces a second-step conflict without retrying or reporting success", async () => {
  s.episode.mockRejectedValueOnce(new Error("IP changed; refresh before saving"));
  render(false, true);
  await click("freePreview");
  expect(s.episode).toHaveBeenCalledTimes(1);
  expect(s.episode).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 12 }));
  expect(s.error).toHaveBeenCalledWith("IP changed; refresh before saving");
  expect(s.success).not.toHaveBeenCalled();
});

it.each([0, 1])("does not rewrite malformed episode price field %s", async (index) => {
  render(false, true);
  await click("editPrice");
  if (index === 1)
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "pricingPanel.schedule.toggle")!
        .click()
    );
  act(() => {
    const input = host.querySelectorAll("input")[index]!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "-50");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelectorAll("input")[index]!.value).toBe("-50");
  await click("save");
  expect(s.price).not.toHaveBeenCalled();
});
