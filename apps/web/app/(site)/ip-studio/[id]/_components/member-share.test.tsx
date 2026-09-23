import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemberRow, AddMemberDialog } from "./ip-studio-workbench";
import type { IpCreatorIp, IpCreatorContributor } from "@/src/lib/ip-commerce/api";
const state = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), error: vi.fn() }));
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useCreateIpCommerceContributor: () => ({ mutateAsync: state.create, isPending: false }),
  useSearchIpCommerceUsers: () => ({
    mutateAsync: async () => [{ userId: "user", nickname: "Creator" }],
    isPending: false,
  }),
  useUpdateIpCommerceContributor: () => ({ mutateAsync: state.update, isPending: false }),
  useDeleteIpCommerceContributor: () => ({ isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: state.error } }));
vi.mock("@/src/env", () => ({ env: {} }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.create.mockReset().mockResolvedValue({});
  state.update.mockReset().mockResolvedValue({});
  state.error.mockClear();
  const contributor = {
    id: "member",
    userId: "user",
    displayName: "Creator",
    role: "writer",
    revenueEligible: true,
    revenueShareBps: 2500,
  } as IpCreatorContributor;
  act(() =>
    root.render(
      <MemberRow
        ip={{ id: "ip" } as IpCreatorIp}
        contributor={contributor}
        contributors={[contributor]}
        t={(key) => key}
      />
    )
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function edit(value: string) {
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
}
it.each(["1..5", ".", "9".repeat(400), "-5", "1e2", "1,5", "abc", "12abc"])(
  "does not clear the share for malformed percentage %s",
  async (value) => {
    await edit(value);
    expect(state.update).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith("membersPanel.invalidShare");
  }
);
it("keeps explicit blank-to-clear behavior", async () => {
  await edit("");
  expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ revenueShareBps: null }));
});
it("saves a valid decimal percentage", async () => {
  await edit("12.34");
  expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ revenueShareBps: 1234 }));
});

it.each(["1..5", "-5", "1e2", "1,5", "abc", "12abc"])(
  "blocks malformed share %s when adding a linked eligible contributor",
  async (value) => {
    await act(async () =>
      root.render(
        <AddMemberDialog
          open
          onOpenChange={() => {}}
          ip={{ id: "ip" } as IpCreatorIp}
          contributors={[]}
          t={(key) => key}
        />
      )
    );
    const enter = async (selector: string, value: string) => {
      await act(async () => {
        const input = document.querySelector<HTMLInputElement>(selector)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          value
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await enter('input[placeholder="membersPanel.linkUserPlaceholder"]', "creator");
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent === "membersPanel.lookup")!
        .click()
    );
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("Creator"))!
        .click()
    );
    await act(async () =>
      document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
    );
    await enter('input[aria-label="membersPanel.shareAriaLabel"]', value);
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent === "membersPanel.add")!
        .click()
    );
    expect(state.create).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith("membersPanel.invalidShare");
  }
);
