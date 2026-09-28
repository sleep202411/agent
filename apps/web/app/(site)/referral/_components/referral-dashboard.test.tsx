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
  useTranslations: () => (key: string) => key,
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
