// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { ReferralsPanel } from "./referrals-panel";
import type { ReferralConfig } from "./referrals-types";
vi.mock("../billing/shared", async (original) => ({
  ...(await original<object>()),
  AdminDialog: ({
    open,
    children,
    onClose,
  }: {
    open: boolean;
    children: ReactNode;
    onClose: () => void;
  }) =>
    open ? (
      <section role="dialog">
        <button onClick={onClose}>Close fixture</button>
        {children}
      </section>
    ) : null,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const config: ReferralConfig = {
  key: "global",
  enabled: true,
  currency: "USD",
  holdDays: 7,
  rewardPerReferralMinor: "0",
  maxRewardedReferees: 0,
  commissionBps: 1000,
  refereeMaxAccountAgeHours: 0,
  giftedPointsValidityDays: 30,
  inviteeBenefitTitle: null,
  inviteeBenefitDetail: null,
  inviteeBenefitMinor: "0",
  inviteeBenefitExpiresInDays: null,
  inviteeBenefitItems: [],
  milestones: [
    {
      id: "tier",
      inviteeThreshold: 10,
      payoutType: "cash",
      rewardMinor: "10",
      payoutDays: 0,
      title: "Tier one",
      detail: "",
      rank: 1,
      archivedAt: null,
    },
  ],
};
const response = (data: unknown = config) => ({
  ok: true,
  json: () => Promise.resolve({ code: 200, data }),
});
function deferred() {
  let resolve!: (r: ReturnType<typeof response>) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<ReturnType<typeof response>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function render(session = "alice") {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey={session}>
        <ReferralsPanel siteLabel="Global" databaseLabel="Fixture" initialConfig={config} />
      </AdminSessionBoundary>
    )
  );
}
function click(text: string) {
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!.click();
}
function submit() {
  container
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("excludes rapid program saves and refreshes and retains failed form values", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
  await render();
  await act(async () => click("编辑配置"));
  const field = container.querySelector<HTMLInputElement>('input[name="currency"]')!;
  field.value = "CNY";
  await act(async () => {
    submit();
    submit();
    click("刷新");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector<HTMLButtonElement>('form button[type="submit"]')?.disabled).toBe(
    true
  );
  await act(async () => pending.reject(new Error("Program unavailable")));
  expect(container.textContent).toContain("Program unavailable");
  expect(field.value).toBe("CNY");
  await act(async () => submit());
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).currency).toBe("CNY");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it("cancels abandoned program writes and leaves replacement dialogs open", async () => {
  const old = deferred();
  fetchMock.mockReturnValueOnce(old.promise);
  await render();
  await act(async () => click("编辑配置"));
  await act(async () => submit());
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await act(async () => click("Close fixture"));
  expect(signal.aborted).toBe(true);
  await act(async () => click("新建阶梯"));
  await act(async () => old.resolve(response()));
  expect(container.querySelector('[role="dialog"] form')).not.toBeNull();
});
it("keeps milestone mutation and follow-up read in the same claim", async () => {
  const follow = deferred();
  fetchMock
    .mockResolvedValueOnce(response({}))
    .mockReturnValueOnce(follow.promise)
    .mockResolvedValue(response());
  await render();
  await act(async () => click("编辑"));
  await act(async () => submit());
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][1].signal).toBe(fetchMock.mock.calls[1][1].signal);
  await act(async () => click("刷新"));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () => follow.reject(new Error("Refresh unavailable")));
  expect(container.textContent).toContain("Tier one");
  expect(container.textContent).toContain("Refresh unavailable");
  await act(async () => click("刷新"));
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
it("cancels a session's follow-up read and ignores late configuration", async () => {
  const follow = deferred();
  fetchMock.mockResolvedValueOnce(response({})).mockReturnValueOnce(follow.promise);
  await render();
  await act(async () => click("编辑"));
  await act(async () => submit());
  const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
  await render("bob");
  expect(signal.aborted).toBe(true);
  await act(async () => follow.resolve(response({ ...config, currency: "STALE" })));
  expect(container.textContent).not.toContain("STALE");
});

it("blocks unsafe reward amounts before sending and preserves the exact draft", async () => {
  await render();
  await act(async () => click("编辑配置"));
  const input = container.querySelector<HTMLInputElement>('input[name="rewardPerReferralMinor"]')!;
  input.value = "9007199254740993";
  await act(async () => submit());
  expect(fetchMock).not.toHaveBeenCalled();
  expect(input.value).toBe("9007199254740993");
  expect(container.textContent).toContain("whole number");
  input.value = "123";
  fetchMock.mockResolvedValue(response());
  await act(async () => submit());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).rewardPerReferralMinor).toBe(123);
});
