import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccessControlPanel } from "./ip-studio-workbench";
import type { IpCreatorIp } from "@/src/lib/ip-commerce/api";
const s = vi.hoisted(() => ({ grant: vi.fn() }));
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useMyIpAclGrants: () => ({ data: { grants: [], ownerUserId: "owner" }, isLoading: false }),
  useGrantIpEditAccess: () => ({ mutateAsync: s.grant, isPending: false }),
  useRevokeIpEditAccess: () => ({ isPending: false }),
  useTransferIpOwner: () => ({ isPending: false }),
  useSearchIpCommerceUsers: () => ({
    mutateAsync: async (value: string) => [{ userId: value, nickname: value }],
    isPending: false,
  }),
}));
vi.mock("@/src/env", () => ({ env: {} }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.grant.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <AccessControlPanel
        ip={
          { id: "ip", viewerAccess: { canManageAcl: true, canTransferOwner: true } } as IpCreatorIp
        }
        contributors={[]}
        locale="en-US"
        t={(key, values) => (key === "membersPanel.lookupFound" ? `Selected ${values?.name}` : key)}
      />
    )
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function click(text: string) {
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === text)!.click()
  );
}
async function select(name: string) {
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("membersPanel.lookup");
  await act(async () => host.querySelector<HTMLButtonElement>("li button")!.click());
}
it("retains a replacement account selection when an earlier grant succeeds", async () => {
  let finish!: () => void;
  s.grant
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValueOnce({});
  await select("Alice");
  await click("membersPanel.accessGrant");
  await click("membersPanel.unlink");
  await select("Bob");
  await act(async () => finish());
  expect(host.textContent).toContain("Selected Bob");
  await click("membersPanel.accessGrant");
  expect(s.grant.mock.calls.map(([request]) => request.userId)).toEqual(["Alice", "Bob"]);
  expect(host.textContent).not.toContain("Selected Bob");
});
it("retains the submitted account when granting fails", async () => {
  s.grant.mockRejectedValue(new Error("Grant unavailable"));
  await select("Alice");
  await click("membersPanel.accessGrant");
  expect(host.textContent).toContain("Selected Alice");
});
