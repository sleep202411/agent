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
function render(free: boolean, priced: boolean, version = 10, amount = "20") {
  act(() =>
    root.render(
      <EpisodePriceEditor
        ip={{ id: "ip", version } as IpCreatorIp}
        episode={
          {
            id: "ep",
            title: "Episode",
            isFreePreview: free,
            price: priced ? { amount } : null,
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

function editAmount(value: string) {
  act(() => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("opens the refreshed price and discards a cancelled draft", async () => {
  render(false, true);
  render(false, true, 11, "30");
  await click("editPrice");
  expect(host.querySelector("input")!.value).toBe("30");
  editAmount("50");
  await click("cancel");
  await click("editPrice");
  expect(host.querySelector("input")!.value).toBe("30");
});
it("preserves the original edit version when the IP refreshes", async () => {
  render(false, true);
  await click("editPrice");
  editAmount("50");
  render(false, true, 11, "30");
  s.price.mockRejectedValueOnce(new Error("Version conflict"));
  await click("save");
  expect(s.price).toHaveBeenCalledWith(
    expect.objectContaining({ amount: "50", expectedVersion: 10 })
  );
  expect(host.querySelector("input")!.value).toBe("50");
  expect(s.error).toHaveBeenCalledWith("Version conflict");
});
it("retains its own completed transition version when retrying the price write", async () => {
  render(true, false);
  await click("setPrice");
  editAmount("20");
  s.price.mockRejectedValueOnce(new Error("Price write unavailable"));
  await click("save");
  expect(s.episode).toHaveBeenCalledOnce();
  render(false, false, 12);
  await click("save");
  expect(s.episode).toHaveBeenCalledOnce();
  expect(s.price).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 11 }));
});
