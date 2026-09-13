// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { IpCrewOrigin } from "./ip-crew-origin";
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: null }) }));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());
it.each([null, { id: "crew", name: "Origin Crew" }])(
  "renders actual crew envelopes without a false request error: %j",
  async (crew) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: 200, data: { crew } })));
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(<IpCrewOrigin ipId="ip" />));
      expect(container.textContent).not.toContain("Request failed");
      if (crew) expect(container.textContent).toContain(crew.name);
      else expect(container.textContent).toBe("");
    } finally {
      act(() => root.unmount());
    }
  }
);
