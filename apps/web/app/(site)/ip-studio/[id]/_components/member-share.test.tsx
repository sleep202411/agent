import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemberRow, AddMemberDialog, MembersPanel } from "./ip-studio-workbench";
import type { IpCreatorIp, IpCreatorContributor } from "@/src/lib/ip-commerce/api";
const state = vi.hoisted(() => ({
  create: vi.fn(),
  creating: false,
  update: vi.fn(),
  error: vi.fn(),
  readError: null as Error | null,
  fetching: false,
  retry: vi.fn(),
}));
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useMyIpContributors: () => ({
    data: { contributors: [], poolAllocatedBps: 0 },
    error: state.readError,
    isFetching: state.fetching,
    refetch: state.retry,
  }),
  useMyIpAclGrants: () => ({}),
  useGrantIpEditAccess: () => ({}),
  useRevokeIpEditAccess: () => ({}),
  useTransferIpOwner: () => ({}),
  useCreateIpCommerceContributor: () => ({ mutateAsync: state.create, isPending: state.creating }),
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
  state.creating = false;
  state.create.mockReset().mockResolvedValue({});
  state.update.mockReset().mockResolvedValue({});
  state.error.mockClear();
  state.readError = null;
  state.fetching = false;
  state.retry.mockReset();
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

it("keeps a failed percentage draft for retry", async () => {
  state.update.mockRejectedValueOnce(new Error("Offline"));
  await edit("12.34");
  expect(host.querySelector("input")!.value).toBe("12.34");
  expect(state.error).toHaveBeenCalledWith("Offline");
  await act(async () =>
    host.querySelector("input")!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
  );
  expect(state.update).toHaveBeenCalledTimes(2);
  expect(state.update).toHaveBeenLastCalledWith(expect.objectContaining({ revenueShareBps: 1234 }));
});

it("preserves an edited share through background refresh but refreshes untouched values", async () => {
  const rerender = (bps: number) => {
    const contributor = {
      id: "member",
      userId: "user",
      displayName: "Creator",
      role: "writer",
      revenueEligible: true,
      revenueShareBps: bps,
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
  };
  rerender(3000);
  expect(host.querySelector("input")!.value).toBe("30");
  act(() => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "12.34");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  rerender(4000);
  expect(host.querySelector("input")!.value).toBe("12.34");
  await act(async () =>
    host.querySelector("input")!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
  );
  expect(state.update).toHaveBeenLastCalledWith(expect.objectContaining({ revenueShareBps: 1234 }));
  rerender(5000);
  expect(host.querySelector("input")!.value).toBe("50");
});

it("keeps an open contributor draft through background list failure and retry", async () => {
  const renderPanel = () =>
    act(() =>
      root.render(
        <MembersPanel
          ip={{ id: "ip", viewerAccess: { canManageAcl: false } } as IpCreatorIp}
          t={(key) => key}
          locale="en-US"
        />
      )
    );
  const button = (label: string) =>
    [...document.querySelectorAll("button")].find((b) => b.textContent === label)!;
  renderPanel();
  act(() => button("membersPanel.addMember").click());
  const input = document.querySelector<HTMLInputElement>(
    'input[placeholder="membersPanel.displayNamePlaceholder"]'
  )!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "New creator"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  state.readError = new Error("Background offline");
  renderPanel();
  expect(document.querySelector('input[placeholder="membersPanel.displayNamePlaceholder"]')).toBe(
    input
  );
  expect(input.value).toBe("New creator");
  expect(host.textContent).toContain("Background offline");
  await act(async () => button("membersPanel.retry").click());
  expect(state.retry).toHaveBeenCalledOnce();
  state.fetching = true;
  renderPanel();
  expect(button("membersPanel.retry").disabled).toBe(true);
  state.fetching = false;
  state.readError = null;
  renderPanel();
  expect(input.value).toBe("New creator");
});

it("prevents editing or dismissing a contributor while its save is pending", async () => {
  const close = vi.fn();
  state.creating = true;
  await act(async () =>
    root.render(
      <AddMemberDialog
        open
        onOpenChange={close}
        ip={{ id: "ip" } as IpCreatorIp}
        contributors={[]}
        t={(key) => key}
      />
    )
  );
  const input = document.querySelector<HTMLInputElement>(
    'input[placeholder="membersPanel.displayNamePlaceholder"]'
  )!;
  expect(input.matches(":disabled")).toBe(true);
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(close).not.toHaveBeenCalled();
});
