import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreatorHero } from "./hero";
import { CREATOR_SECTION_ID } from "./tab-bar";
import type { Creator } from "../../_hooks/use-creator";

const state = vi.hoisted(() => ({ locale: "en-US" }));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => state.locale,
}));
vi.mock("@/src/hooks/use-user", () => ({
  useUploadAvatar: () => ({ isPending: false }),
}));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => <span>Avatar</span> }));

let root: Root, host: HTMLDivElement, client: QueryClient;
const creator = { id: "100", name: "Creator", levels: [] } as unknown as Creator;
beforeEach(() => {
  client = new QueryClient();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  client.clear();
});

it("takes visitors to the service packages instead of advertising unavailable actions", async () => {
  await act(async () => root.render(<CreatorHero creator={creator} isOwner={false} />));
  const link = host.querySelector("a")!;
  expect(link.textContent).toBe("cta.viewServices");
  expect(link.getAttribute("href")).toBe(`#${CREATOR_SECTION_ID("services")}`);
  expect(host.textContent).not.toContain("cta.startRequest");
  expect(host.textContent).not.toContain("cta.message");
  expect(host.textContent).not.toContain("cta.follow");
});

it.each(["en-US", "zh-CN", "zh-HK"])(
  "opens the localized inbox for owners (%s)",
  async (locale) => {
    state.locale = locale;
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <CreatorHero creator={creator} isOwner />
        </QueryClientProvider>
      )
    );
    const more = host.querySelector('button[aria-label="cta.more"]')!;
    await act(async () =>
      more.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    );
    const inbox = Array.from(document.querySelectorAll("a")).find(
      (link) => link.textContent === "cta.inbox"
    );
    expect(inbox?.getAttribute("href")).toBe(`/${locale}/messages`);
  }
);
