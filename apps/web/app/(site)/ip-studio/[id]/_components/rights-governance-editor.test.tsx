import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RightsGovernanceEditor } from "./ip-studio-workbench";
import type { IpCreatorIp } from "@/src/lib/ip-commerce/api";

const s = vi.hoisted(() => ({ save: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useUpdateIpCommerceIpProfile: () => ({ mutateAsync: s.save, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: s.success, error: s.error } }));
vi.mock("@/src/env", () => ({ env: {} }));
let root: Root, host: HTMLDivElement;
const ip = (version: number, owner = "Original") =>
  ({
    id: "ip",
    version,
    copyrightOwner: owner,
    rightsSummary: {},
    aiDisclosure: {},
  }) as IpCreatorIp;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  root = createRoot(host);
  s.save.mockReset().mockResolvedValue({ ip: ip(11, "My edit") });
  s.success.mockClear();
  s.error.mockClear();
});
afterEach(() => act(() => root.unmount()));
function render(value: IpCreatorIp) {
  act(() => root.render(<RightsGovernanceEditor ip={value} t={(key: string) => key} />));
}
function edit(value: string) {
  act(() => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const save = () => host.querySelector("button")!;
it("refreshes an untouched form without turning old values into a saveable edit", () => {
  render(ip(10));
  render(ip(11, "Remote owner"));
  expect(host.querySelector("input")!.value).toBe("Remote owner");
  expect(save().disabled).toBe(true);
});
it("keeps a dirty draft tied to its original version after a remote refresh", async () => {
  render(ip(10));
  edit("My edit");
  render(ip(11, "Remote owner"));
  s.save.mockRejectedValueOnce(new Error("Version conflict"));
  await act(async () => save().click());
  expect(s.save).toHaveBeenCalledWith(
    expect.objectContaining({
      copyrightOwner: "My edit",
      expectedVersion: 10,
    })
  );
  expect(s.error).toHaveBeenCalledWith("Version conflict");
  expect(host.querySelector("input")!.value).toBe("My edit");
});
it("uses the successful save version for a subsequent edit", async () => {
  render(ip(10));
  edit("My edit");
  await act(async () => save().click());
  expect(save().disabled).toBe(true);
  edit("Next edit");
  await act(async () => save().click());
  expect(s.save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 11 }));
});

it("preserves typing during a pending save and advances only to the saved version", async () => {
  let resolve!: (result: { ip: IpCreatorIp }) => void;
  s.save.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  render(ip(10));
  edit("My edit");
  act(() => save().click());
  edit("Still typing");
  render(ip(11, "My edit"));
  await act(async () => resolve({ ip: ip(11, "My edit") }));
  expect(host.querySelector("input")!.value).toBe("Still typing");
  expect(save().disabled).toBe(false);
  await act(async () => save().click());
  expect(s.save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      copyrightOwner: "Still typing",
      expectedVersion: 11,
    })
  );
});
it("refreshes to the latest server values when the user reverts the draft", () => {
  render(ip(10));
  edit("My edit");
  render(ip(11, "Remote owner"));
  edit("Original");
  expect(host.querySelector("input")!.value).toBe("Remote owner");
  expect(save().disabled).toBe(true);
});
