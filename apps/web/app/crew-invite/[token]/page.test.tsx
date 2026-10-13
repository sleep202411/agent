import { act, StrictMode, type ButtonHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
import { CrewApiError } from "@/app/(site)/crews/_hooks/api";
const mocks = vi.hoisted(() => ({
  token: "first",
  userId: "alice" as string | null,
  get: vi.fn(),
  post: vi.fn(),
  push: vi.fn(),
  open: vi.fn(),
  t: (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useParams: () => ({ token: mocks.token }),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: mocks.userId ? { id: mocks.userId } : null }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useLocale: () => "en-US", useTranslations: () => mocks.t }));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: mocks.open }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));
vi.mock("@/app/(site)/crews/_hooks/api", () => ({
  crewApi: { get: mocks.get, post: mocks.post },
  CrewApiError: class extends Error {
    constructor(
      public status: number,
      public body: unknown
    ) {
      super(typeof body === "string" ? body : "Qualifications required");
    }
  },
}));
function deferred() {
  let resolve!: (v: unknown) => void;
  let reject!: (v: unknown) => void;
  const promise = new Promise((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}
let root: Root, host: HTMLDivElement;
const render = () =>
  act(async () =>
    root.render(
      <StrictMode>
        <Page />
      </StrictMode>
    )
  );
function button(label: string) {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  expect(found).toBeTruthy();
  return found!;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  mocks.token = "first";
  mocks.userId = "alice";
  mocks.get.mockImplementation(async () => ({
    scope: "crew_community",
    crewId: mocks.token,
    targetName: mocks.token,
    status: "active",
    memberCount: 1,
  }));
  host = document.createElement("div");
  root = createRoot(host);
  await render();
});
afterEach(() => act(() => root.unmount()));
it("dispatches one join for rapid clicks and opens the returned community destination", async () => {
  const request = deferred();
  mocks.post.mockReturnValue(request.promise);
  const join = button("join");
  act(() => {
    join.click();
    join.click();
  });
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(mocks.post).toHaveBeenCalledWith("/invites/accept", { body: { token: "first" } });
  await act(async () =>
    request.resolve({
      data: {
        scope: "crew_community",
        targetName: "first",
        channelHref: "/crews/first/workspace?tab=chat&channel=community",
      },
    })
  );
  act(() => button("openChannel").click());
  expect(mocks.push).toHaveBeenCalledWith(
    "/en-US/crews/first/workspace?tab=chat&channel=community"
  );
});
it.each(["account", "token"])("ignores a join result after changing %s", async (change) => {
  const request = deferred();
  mocks.post.mockReturnValue(request.promise);
  act(() => button("join").click());
  if (change === "account") mocks.userId = "bob";
  else mocks.token = "second";
  await render();
  expect(button("join").disabled).toBe(false);
  await act(async () =>
    request.resolve({ scope: "crew_community", targetName: "old result", channelHref: "/old" })
  );
  expect(host.textContent).not.toContain("openChannel");
  expect(button("join").disabled).toBe(false);
});
it.each(["account", "token", "leave"])(
  "does not open login for a stale join failure after %s",
  async (change) => {
    const request = deferred();
    mocks.post.mockReturnValue(request.promise);
    act(() => button("join").click());
    if (change === "account") mocks.userId = "bob";
    if (change === "token") mocks.token = "second";
    if (change === "leave") act(() => root.render(null));
    else await render();
    await act(async () => request.reject(new CrewApiError(401, "Expired session")));
    expect(mocks.open).not.toHaveBeenCalled();
  }
);
it("clears completed membership state when the account changes", async () => {
  mocks.post.mockResolvedValue({
    scope: "crew_community",
    targetName: "first",
    channelHref: "/first",
  });
  await act(async () => button("join").click());
  expect(button("openChannel")).toBeTruthy();
  mocks.userId = "bob";
  await render();
  expect(host.textContent).not.toContain("openChannel");
  expect(button("join")).toBeTruthy();
});
it("allows a retry after a current request fails", async () => {
  mocks.post.mockRejectedValueOnce(new CrewApiError(500, "Try later"));
  await act(async () => button("join").click());
  expect(host.textContent).toContain("Try later");
  mocks.post.mockResolvedValue({
    scope: "crew_community",
    targetName: "first",
    channelHref: "/first",
  });
  await act(async () => button("join").click());
  expect(mocks.post).toHaveBeenCalledTimes(2);
  expect(button("openChannel")).toBeTruthy();
});
it("retains the invitation through sign-in and refreshes its preview", async () => {
  mocks.get.mockRejectedValue(new CrewApiError(401, "Login required"));
  mocks.userId = null;
  await render();
  act(() => button("signIn").click());
  const options = mocks.open.mock.calls[0]![0];
  expect(options.mode).toBe("stay");
  mocks.get.mockResolvedValue({
    scope: "crew_community",
    crewId: "first",
    targetName: "first",
    status: "active",
    memberCount: 1,
  });
  await act(async () => options.onSuccess());
  expect(mocks.get).toHaveBeenLastCalledWith("/invites/preview", { query: { token: "first" } });
  expect(button("join")).toBeTruthy();
});
it("ignores an obsolete sign-in callback after another invitation is opened", async () => {
  mocks.get.mockRejectedValue(new CrewApiError(401, "Login required"));
  mocks.userId = null;
  await render();
  act(() => button("signIn").click());
  const options = mocks.open.mock.calls[0]![0];
  mocks.token = "second";
  mocks.get.mockResolvedValue({
    scope: "crew_community",
    crewId: "second",
    targetName: "second",
    status: "active",
    memberCount: 1,
  });
  await render();
  const count = mocks.get.mock.calls.length;
  await act(async () => options.onSuccess());
  expect(mocks.get).toHaveBeenCalledTimes(count);
  expect(button("join")).toBeTruthy();
});
it.each(["crew", "crew_community"])(
  "preserves the %s destination for an already-joined response",
  async (scope) => {
    mocks.token = "second";
    mocks.get.mockResolvedValue({
      scope,
      crewId: "second",
      targetName: "second",
      status: "active",
      memberCount: 1,
    });
    await render();
    mocks.post.mockRejectedValue(new CrewApiError(409, "Already joined"));
    await act(async () => button("join").click());
    act(() => button(scope === "crew" ? "openWorkspace" : "openChannel").click());
    expect(mocks.push).toHaveBeenCalledWith(
      `/en-US/crews/second/workspace${scope === "crew" ? "" : "?tab=chat&channel=community"}`
    );
  }
);

async function renderTaskOffer() {
  mocks.get.mockResolvedValue({
    scope: "crew",
    crewId: "crew",
    targetName: "Crew",
    status: "active",
    memberCount: 1,
    task: {
      id: "task",
      version: 3,
      title: "Animate scene",
      description: "Deliver a five-second clip",
      paymentTerms: "half_upfront",
      rewardUsdMinor: 12000,
      profitShareBps: 250,
      dueAt: "2027-01-01T12:00:00Z",
      requiredSkills: ["Animation"],
    },
  });
  mocks.token = "task-link";
  await render();
}
it("shows the task terms before acceptance", async () => {
  await renderTaskOffer();
  expect(host.textContent).toContain("Animate scene");
  expect(host.textContent).toContain("Deliver a five-second clip");
  expect(host.textContent).toContain("$120.00");
  expect(host.textContent).toContain("half_upfront");
  expect(host.textContent).toContain("2.5%");
  expect(host.textContent).toContain("Animation");
  expect(mocks.post).not.toHaveBeenCalled();
  await act(async () => button("acceptTask").click());
  expect(mocks.post).toHaveBeenCalledWith("/invites/accept", { body: { token: "task-link" } });
});
it.each([403, 409])(
  "does not turn a task acceptance failure (%s) into membership success",
  async (status) => {
    await renderTaskOffer();
    mocks.post.mockRejectedValue(new CrewApiError(status, "Task cannot be claimed"));
    await act(async () => button("acceptTask").click());
    expect(host.textContent).toContain("Task cannot be claimed");
    expect(host.textContent).not.toContain("openWorkspace");
    expect(host.textContent).not.toContain("removedTitle");
  }
);
it("reopens an already accepted task without claiming it again", async () => {
  mocks.get.mockResolvedValue({
    scope: "crew",
    crewId: "crew",
    targetName: "Crew",
    status: "exhausted",
    acceptedHref: "/crews/crew/workspace?tab=tasks&task=task",
  });
  mocks.token = "accepted-task";
  await render();
  await act(async () => button("openWorkspace").click());
  expect(mocks.push).toHaveBeenCalledWith("/en-US/crews/crew/workspace?tab=tasks&task=task");
  expect(mocks.post).not.toHaveBeenCalled();
});

vi.mock("@/app/(site)/creators/_components/center/dialogs/level-apply-dialog", () => ({
  LevelApplyDialog: ({ open }: { open: boolean }) => (open ? <div>verification form</div> : null),
}));
it("shows verification only after a confirmed qualification rejection", async () => {
  await renderTaskOffer();
  expect(host.textContent).not.toContain("goVerification");
  mocks.post.mockRejectedValueOnce(new CrewApiError(403, { code: "CREW_QUALIFICATIONS_REQUIRED" }));
  await act(async () => button("acceptTask").click());
  await act(async () => button("goVerification").click());
  expect(host.textContent).toContain("verification form");
  expect(mocks.post).toHaveBeenCalledTimes(1);
});
