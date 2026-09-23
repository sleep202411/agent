import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewAgreementsDialog } from "./crew-agreements-dialog";
const state = vi.hoisted(() => ({
  account: "alice",
  create: vi.fn(),
  sign: vi.fn(),
  sync: vi.fn(),
  send: vi.fn(),
  archive: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({
  useUserDisplays: () => new Map(),
  displayNameOf: (id: string) => id,
}));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogBody: Part,
    DialogContent: Part,
    DialogDescription: Part,
    DialogFooter: Part,
    DialogHeader: Part,
    DialogTitle: Part,
  };
});
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    disabled?: boolean;
    children: ReactNode;
  }) => (
    // eslint-disable-next-line no-restricted-syntax -- Native control substitutes for the mocked Select in an interaction test.
    <select value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => {
  const mutation = (fn: typeof state.create) => ({
    isPending: false,
    mutateAsync: fn,
    mutate: (id: string, handlers: { onSuccess: () => void; onError: (e: unknown) => void }) =>
      void fn(id).then(handlers.onSuccess, handlers.onError),
  });
  return {
    useCrewAgreements: () => ({
      data: {
        items: [
          {
            id: "agreement",
            title: "Agreement",
            signerName: "Signer",
            signerEmail: "person@example.com",
            status: "sent",
            providerDocumentId: "provider",
            capabilities: { sign: true },
            delivery: { status: "completed", canRetry: true },
            archive: { status: "pending", canRetry: true },
          },
        ],
        capabilities: { create: true, sync: true },
        summary: {},
      },
      isLoading: false,
      isError: false,
      hasNextPage: false,
    }),
    useCreateCrewAgreement: () => mutation(state.create),
    useCreateCrewAgreementSigningSession: () => mutation(state.sign),
    useSyncCrewAgreement: () => mutation(state.sync),
    useRetryCrewAgreementSend: () => mutation(state.send),
    useRetryCrewAgreementArchive: () => mutation(state.archive),
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  state.account = "alice";
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});
async function render(open = true, crewId = "crew") {
  await act(async () =>
    root.render(
      <CrewAgreementsDialog
        crewId={crewId}
        members={[
          { userId: "member" } as import("@/app/(site)/crews/_hooks/use-crew").CrewMemberDTO,
          { userId: "other-member" } as import("@/app/(site)/crews/_hooks/use-crew").CrewMemberDTO,
        ]}
        isOwner
        open={open}
        onOpenChange={() => {}}
      />
    )
  );
}
function button(text: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
function deferred() {
  let resolve!: (v: unknown) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function popup() {
  const p = {
    closed: false,
    opener: {},
    document: { title: "" },
    location: { replace: vi.fn() },
    close: vi.fn(),
  };
  p.close.mockImplementation(() => {
    p.closed = true;
  });
  return p;
}
async function fill() {
  await click("newAgreement");
  await act(async () => {
    const select = host.querySelector("select")!;
    select.value = "member";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    for (const [i, value] of ["Signer", "person@example.com", "My agreement"].entries()) {
      const input = host.querySelectorAll("input")[i]!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}
it("prevents duplicate creation and preserves failed drafts", async () => {
  const r = deferred();
  state.create.mockReturnValue(r.promise);
  await render();
  await fill();
  await act(async () => {
    const b = button("queueWithBoldSign");
    b.click();
    b.click();
  });
  expect(state.create).toHaveBeenCalledTimes(1);
  expect([...host.querySelectorAll("input")].every((i) => i.disabled)).toBe(true);
  await act(async () => r.reject(new Error("Specific error")));
  expect(state.error).toHaveBeenCalledWith("Specific error");
  expect([...host.querySelectorAll("input")].map((i) => i.value)).toEqual([
    "Signer",
    "person@example.com",
    "My agreement",
  ]);
  const retry = deferred();
  state.create.mockReturnValue(retry.promise);
  await click("queueWithBoldSign");
  expect(state.create).toHaveBeenCalledTimes(2);
  await act(async () => retry.resolve({}));
});
it.each(["account", "crew", "close"])(
  "drops creation results and pending signing windows after %s changes",
  async (change) => {
    const r = deferred(),
      sign = deferred(),
      p = popup();
    state.create.mockReturnValue(r.promise);
    state.sign.mockReturnValue(sign.promise);
    vi.spyOn(window, "open").mockReturnValue(p as unknown as Window);
    await render();
    await fill();
    await click("queueWithBoldSign");
    await click("reviewAndSign");
    if (change === "account") state.account = "bob";
    if (change === "close") await render(false);
    await render(true, change === "crew" ? "next" : "crew");
    expect(host.querySelector("input")).toBeNull();
    expect(p.close).toHaveBeenCalledTimes(1);
    await fill();
    await act(async () => {
      r.resolve({});
      sign.resolve({ signLink: "https://sign.example/session" });
    });
    expect(host.querySelector("input")?.value).toBe("Signer");
    expect(p.location.replace).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
  }
);
it("opens one signing popup and preserves it after successful navigation", async () => {
  const r = deferred(),
    p = popup();
  state.sign.mockReturnValue(r.promise);
  const open = vi.spyOn(window, "open").mockReturnValue(p as unknown as Window);
  await render();
  await act(async () => {
    const b = button("reviewAndSign");
    b.click();
    b.click();
    button("sync").click();
  });
  expect(open).toHaveBeenCalledTimes(1);
  expect(state.sign).toHaveBeenCalledTimes(1);
  expect(state.sync).not.toHaveBeenCalled();
  await act(async () => r.resolve({ signLink: "https://sign.example/session" }));
  expect(p.location.replace).toHaveBeenCalledWith("https://sign.example/session");
  await render(false);
  expect(p.close).not.toHaveBeenCalled();
});
it("recovers after a blocked popup and ignores manually closed pending windows", async () => {
  const r = deferred(),
    p = popup();
  state.sign.mockReturnValue(r.promise);
  vi.spyOn(window, "open")
    .mockReturnValueOnce(null)
    .mockReturnValue(p as unknown as Window);
  await render();
  await click("reviewAndSign");
  expect(state.sign).not.toHaveBeenCalled();
  expect(state.error).toHaveBeenCalledWith("popupBlocked");
  await click("reviewAndSign");
  p.closed = true;
  await act(async () => r.resolve({ signLink: "https://sign.example/session" }));
  expect(p.location.replace).not.toHaveBeenCalled();
});
it.each(["sync", "sendRetry", "archiveRetry"])(
  "prevents competing %s actions and suppresses ended-session errors",
  async (action) => {
    const r = deferred();
    state.sync.mockReturnValue(r.promise);
    state.send.mockReturnValue(r.promise);
    state.archive.mockReturnValue(r.promise);
    await render();
    await act(async () => {
      button(action).click();
      button("sync").click();
      button("sendRetry").click();
      button("archiveRetry").click();
    });
    expect(
      state.sync.mock.calls.length + state.send.mock.calls.length + state.archive.mock.calls.length
    ).toBe(1);
    await render(false);
    await act(async () => r.reject(new Error("Old error")));
    expect(state.error).not.toHaveBeenCalled();
  }
);

it("requires a new signer email when switching the agreement member", async () => {
  state.create.mockResolvedValue({});
  await render();
  await fill();
  await act(async () => {
    const select = host.querySelector("select")!;
    select.value = "other-member";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const email = host.querySelector<HTMLInputElement>('input[type="email"]')!;
  expect(email.value).toBe("");
  expect(host.querySelectorAll("input")[0]!.value).toBe("other-member");
  expect(host.querySelectorAll("input")[2]!.value).toBe("My agreement");
  expect(button("queueWithBoldSign").disabled).toBe(true);
  await click("queueWithBoldSign");
  expect(state.create).not.toHaveBeenCalled();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      email,
      "other@example.com"
    );
    email.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("queueWithBoldSign");
  expect(state.create).toHaveBeenCalledWith({
    memberUserId: "other-member",
    signerName: "other-member",
    signerEmail: "other@example.com",
    title: "My agreement",
  });
});
