import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AddMemberDialog } from "./ip-studio-workbench";
import type { IpCreatorIp, IpUserSearchHit } from "@/src/lib/ip-commerce/api";

const search = vi.hoisted(() => vi.fn());
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useCreateIpCommerceContributor: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSearchIpCommerceUsers: () => ({ mutateAsync: search, isPending: false }),
}));
vi.mock("@/src/env", () => ({ env: {} }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  search.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
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
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function enter(value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="membersPanel.linkUserPlaceholder"]'
    )!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function lookup() {
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent === "membersPanel.lookup")!
      .click()
  );
}
const alice = [{ userId: "alice", nickname: "Alice" }] as IpUserSearchHit[];
const bob = [{ userId: "bob", nickname: "Bob" }] as IpUserSearchHit[];
const resultNames = () => [...document.querySelectorAll("li button")].map((b) => b.textContent);

it("removes selectable results as soon as the account changes", async () => {
  search.mockResolvedValue(alice);
  await enter("alice");
  await lookup();
  expect(resultNames().join()).toContain("Alice");
  await enter("bob");
  expect(resultNames()).toEqual([]);
});

it.each(["success", "failure"])(
  "ignores an obsolete lookup %s after a newer search succeeds",
  async (outcome) => {
    let resolve!: (value: IpUserSearchHit[]) => void;
    let reject!: (error: Error) => void;
    search
      .mockImplementationOnce(
        () =>
          new Promise<IpUserSearchHit[]>((yes, no) => {
            resolve = yes;
            reject = no;
          })
      )
      .mockResolvedValueOnce(bob);
    await enter("alice");
    await lookup();
    await enter("bob");
    await lookup();
    expect(resultNames().join()).toContain("Bob");
    await act(async () => {
      if (outcome === "success") resolve(alice);
      else reject(new Error("Old lookup failed"));
    });
    expect(resultNames().join()).toContain("Bob");
    expect(resultNames().join()).not.toContain("Alice");
    expect(document.body.textContent).not.toContain("Old lookup failed");
  }
);
