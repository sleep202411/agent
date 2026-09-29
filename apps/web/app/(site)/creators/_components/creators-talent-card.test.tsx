import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CreatorsTalentCard } from "./creators-talent-card";
import { encodeUserId } from "@/src/lib/user-id-codec";
const state = vi.hoisted(() => ({ locale: "en-US" }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => state.locale,
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));
it.each(["en-US", "zh-CN", "zh-HK"])(
  "preserves %s in the public profile link and displays qualifications",
  async (locale) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    state.locale = locale;
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <CreatorsTalentCard
            creator={{
              id: "42",
              name: "Artist",
              avatar: "",
              banner: "",
              bio: "",
              joinedAt: "",
              contact: "",
              study: "",
              levels: [
                { id: 13, name: "AI Producer", iconUrl: "", description: "" },
                { id: 101, name: "FD I", iconUrl: "", description: "" },
              ],
            }}
          />
        )
      );
      expect(container.querySelector("a")?.getAttribute("href")).toBe(
        `/${locale}/creators/${encodeUserId("42")}`
      );
      expect(container.textContent).toContain("AI Producer");
      expect(container.textContent).toContain("FD I");
    } finally {
      await act(async () => root.unmount());
    }
  }
);
