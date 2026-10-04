import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_REFERRAL_DASHBOARD, type ReferralDashboard } from "../_hooks/api";
import { ReferralDashboardPage } from "./referral-dashboard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  dashboard: undefined as ReferralDashboard | undefined,
  writeText: vi.fn().mockResolvedValue(undefined),
  share: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.dashboard, isLoading: false }),
  useMutation: () => ({ isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "A" } }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? key + ":" + Object.values(values).join(",") : key,
  useLocale: () => "zh-CN",
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("navigator", {
    clipboard: { writeText: mocks.writeText },
    share: mocks.share,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function renderDashboard(inviteUrl: string | null) {
  mocks.dashboard = {
    ...EMPTY_REFERRAL_DASHBOARD,
    programAvailable: true,
    inviteCode: "CODE9",
    inviteUrl,
  };
  act(() => root.render(<ReferralDashboardPage />));
}

function button(label: string) {
  const result = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === label
  );
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}

describe("referral invitation actions", () => {
  it.each(["https://fizzdragon.com", "https://fizzdragon.fizzspace.cn"])(
    "displays, copies and shares the same %s link",
    async (origin) => {
      const url = `${origin}/register?recommendationCode=CODE9`;
      renderDashboard(url);
      expect(container.textContent).toContain(url);

      await act(async () => button("copy").click());
      expect(mocks.writeText).toHaveBeenCalledExactlyOnceWith(url);

      await act(async () => button("share").click());
      expect(mocks.share).toHaveBeenCalledExactlyOnceWith({ title: "shareTitle", url });
    }
  );

  it("disables both actions when the link is absent, even if a code exists", () => {
    renderDashboard(null);
    expect(button("copy").disabled).toBe(true);
    expect(button("share").disabled).toBe(true);
    expect(mocks.writeText).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
  });
});

it("shows every bundle item for milestones and earned rewards, without duplicating the primary", () => {
  const items = [
    { kind: "points_compute" as const, amountMinor: "150", days: 0 },
    { kind: "membership_community" as const, amountMinor: "0", days: 7 },
  ];
  mocks.dashboard = {
    ...EMPTY_REFERRAL_DASHBOARD,
    programAvailable: true,
    milestones: [
      {
        id: "tier",
        title: "Invite three",
        detail: "",
        status: "active",
        inviteeThreshold: 3,
        ...items[0]!,
        payoutType: "points_compute",
        currency: null,
        items,
      },
    ],
    rewards: [
      {
        id: "reward",
        title: "Welcome bundle",
        status: "accrued",
        claimable: true,
        ...items[0]!,
        payoutType: "points_compute",
        currency: null,
        items,
      },
    ],
  };
  act(() => root.render(<ReferralDashboardPage />));
  for (const row of Array.from(container.querySelectorAll("li"))) {
    expect(row.textContent).toContain("valueMembershipCommunity:7");
    expect(row.textContent?.match(/valuePointsCompute:150/g)).toHaveLength(1);
  }
  expect(container.querySelectorAll("li")).toHaveLength(2);
});

it("still displays a single reward when no bundle is returned", () => {
  mocks.dashboard = {
    ...EMPTY_REFERRAL_DASHBOARD,
    programAvailable: true,
    rewards: [
      {
        id: "single",
        title: "Credit reward",
        status: "paid_out",
        claimable: false,
        payoutType: "points_compute",
        amountMinor: "25",
        days: 0,
        currency: null,
      },
    ],
  };
  act(() => root.render(<ReferralDashboardPage />));
  expect(container.querySelector("li")?.textContent).toContain("valuePointsCompute:25");
});

it("uses the program currency for cash that is not the primary bundle item", () => {
  mocks.dashboard = {
    ...EMPTY_REFERRAL_DASHBOARD,
    programAvailable: true,
    currency: "USD",
    rewards: [
      {
        id: "mixed",
        title: "Mixed reward",
        status: "accrued",
        claimable: true,
        payoutType: "points_compute",
        amountMinor: "50",
        days: 0,
        currency: null,
        items: [
          { kind: "points_compute", amountMinor: "50", days: 0 },
          { kind: "cash", amountMinor: "1250", days: 0 },
        ],
      },
    ],
  };
  act(() => root.render(<ReferralDashboardPage />));
  expect(container.querySelector("li")?.textContent).toContain("12.50");
  expect(container.querySelector("li")?.textContent).toContain("valuePointsCompute:50");
});

it("keeps the earned cash currency when it differs from the current program", () => {
  mocks.dashboard = {
    ...EMPTY_REFERRAL_DASHBOARD,
    programAvailable: true,
    currency: "USD",
    rewards: [
      {
        id: "currency",
        title: "Earned",
        status: "paid_out",
        claimable: false,
        payoutType: "points_compute",
        amountMinor: "50",
        days: 0,
        currency: null,
        items: [{ kind: "cash", amountMinor: "1250", days: 0, currency: "EUR" }],
      },
    ],
  };
  act(() => root.render(<ReferralDashboardPage />));
  expect(container.querySelector("li")?.textContent).toContain("€12.50");
});

it("shows cash totals separately for each currency instead of adding unlike amounts", () => {
  mocks.dashboard = {
    ...EMPTY_REFERRAL_DASHBOARD,
    programAvailable: true,
    currency: "USD",
    cashTotals: [
      { currency: "USD", pendingMinor: "75", confirmedMinor: "1450", reversedMinor: "300" },
      { currency: "EUR", pendingMinor: "400", confirmedMinor: "0", reversedMinor: "0" },
    ],
  };
  act(() => root.render(<ReferralDashboardPage />));
  const headline = container.querySelector("section");
  expect(headline?.textContent).toContain("15.25");
  expect(headline?.textContent).toContain("€4.00");
  expect(headline?.textContent).not.toContain("19.25");
});
