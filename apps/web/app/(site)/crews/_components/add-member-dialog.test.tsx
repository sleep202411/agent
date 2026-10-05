import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AddCrewMemberDialog } from "./add-member-dialog";
const state = vi.hoisted(() => ({
  account: "alice",
  agreements: false,
  invite: vi.fn(),
  close: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  CrewApiError: class extends Error {},
  useInviteCrewMember: () => ({ mutateAsync: state.invite, isPending: false }),
  useCrewAgreements: () => ({
    data: { capabilities: { create: state.agreements } },
    isLoading: false,
  }),
}));
vi.mock("@/app/(site)/crews/_hooks/use-users", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/(site)/crews/_hooks/use-users")>();
  return {
    ...original,
    useUserLookup: ({ query }: { query: string }) =>
      query
        ? {
            kind: "found",
            user: { userId: query, nickname: query, isCrewMember: false, isCrewOwner: false },
          }
        : { kind: "idle" },
  };
});
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));
vi.mock("@/app/(site)/crews/_components/invite-link-panel", () => ({
  InviteLinkPanel: () => null,
}));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogContent: Part,
    DialogBody: Part,
    DialogFooter: Part,
    DialogHero: () => null,
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const originalScroll = HTMLElement.prototype.scrollIntoView;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  state.account = "alice";
  state.agreements = false;
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  HTMLElement.prototype.scrollIntoView = originalScroll;
  vi.useRealTimers();
});
async function render(open = true, crew = "crew") {
  await act(async () =>
    root.render(
      <AddCrewMemberDialog
        open={open}
        onOpenChange={state.close}
        crewId={crew}
        canGrantPolicies={false}
      />
    )
  );
}
async function type(value: string, settle = true) {
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  if (settle) await act(async () => vi.advanceTimersByTime(400));
}
async function submit() {
  await act(async () => {
    const button = [...container.querySelectorAll("button")].at(-1)!;
    button.click();
    button.click();
  });
}
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
it("waits for the current contact lookup before inviting", async () => {
  const request = deferred();
  state.invite.mockReturnValue(request.promise);
  await render();
  await type("first@example.com");
  await type("second@example.com", false);
  await submit();
  expect(state.invite).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(400));
  await submit();
  expect(state.invite).toHaveBeenCalledTimes(1);
  expect(state.invite.mock.calls[0]?.[0]).toMatchObject({ account: "second@example.com" });
  await act(async () => request.resolve({}));
});
it("prevents duplicate invitations and keeps failed inputs for retry", async () => {
  const request = deferred();
  state.invite.mockReturnValue(request.promise);
  await render();
  await type("person@example.com");
  await submit();
  expect(state.invite).toHaveBeenCalledTimes(1);
  await act(async () => request.reject(new Error("Specific failure")));
  expect(state.error).toHaveBeenCalledWith("Specific failure");
  expect(container.querySelector("input")?.value).toBe("person@example.com");
  const retry = deferred();
  state.invite.mockReturnValue(retry.promise);
  await submit();
  expect(state.invite).toHaveBeenCalledTimes(2);
  await act(async () => retry.resolve({}));
  expect(state.close).toHaveBeenCalledWith(false);
});
it.each(["account", "crew", "close"])(
  "resets drafts and ignores old invitation results after %s changes",
  async (change) => {
    const request = deferred();
    state.invite.mockReturnValue(request.promise);
    await render();
    await type("old@example.com");
    await submit();
    if (change === "account") state.account = "bob";
    if (change === "close") await render(false);
    await render(true, change === "crew" ? "next-crew" : "crew");
    expect(container.querySelector("input")?.value).toBe("");
    const next = deferred();
    state.invite.mockReturnValue(next.promise);
    await type("next@example.com");
    await submit();
    await act(async () => request.resolve({}));
    expect(state.close).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
    await submit();
    expect(state.invite).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve({}));
    expect(state.close).toHaveBeenCalledTimes(1);
  }
);
it("suppresses an invitation error after closure", async () => {
  const request = deferred();
  state.invite.mockReturnValue(request.promise);
  await render();
  await type("person@example.com");
  await submit();
  await render(false);
  await act(async () => request.reject(new Error("Old failure")));
  expect(state.error).not.toHaveBeenCalled();
});

it("requires new signer details after changing the invited account", async () => {
  state.agreements = true;
  await render();
  await type("first@example.com");
  await act(async () => container.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
  expect(container.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe(
    "first@example.com"
  );
  await act(async () => {
    const title = container.querySelector<HTMLInputElement>(
      'input[placeholder="addMemberAgreementTitlePlaceholder"]'
    )!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      title,
      "Crew agreement"
    );
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await type("second@example.com");
  expect(container.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe("");
  expect(
    [...container.querySelectorAll("input")].some((input) => input.value === "first@example.com")
  ).toBe(false);
  await submit();
  expect(state.invite).not.toHaveBeenCalled();
  expect(
    container.querySelector<HTMLInputElement>(
      'input[placeholder="addMemberAgreementTitlePlaceholder"]'
    )?.value
  ).toBe("Crew agreement");
  await act(async () => container.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
  await submit();
  expect(state.invite).toHaveBeenCalledWith(
    expect.objectContaining({
      account: "second@example.com",
      agreement: {
        title: "Crew agreement",
        signerName: "second@example.com",
        signerEmail: "second@example.com",
      },
    })
  );
});

it("switches the label and hint to User ID before submitting an ID invitation", async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  state.invite.mockResolvedValue({});
  await render();
  expect(container.querySelector("input")?.placeholder).toBe("addMemberContactPlaceholder");
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="addMemberLookupBy"]')!;
  await act(async () =>
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
  );
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) =>
    node.textContent?.includes("addMemberUserIdLabel")
  )!;
  expect(option).toBeDefined();
  await act(async () => option.click());
  expect(container.querySelector("input")?.placeholder).toBe("addMemberUserIdHint");
  expect(container.querySelector("label")?.textContent).toContain("addMemberUserIdLabel");
  await type("273848");
  await submit();
  expect(state.invite).toHaveBeenCalledWith(
    expect.objectContaining({ account: "273848", lookupBy: "userId" })
  );
});
