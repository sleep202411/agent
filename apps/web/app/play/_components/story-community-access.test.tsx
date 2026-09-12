import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useStoryCommunityAccess } from "./story-community-access";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/src/lib/api", () => ({ api: mocks }));
vi.mock("@/src/i18n/i18n", () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "viewer" } }) }));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ isOpen: false, open: vi.fn() }),
}));
vi.mock("@/components/payment/community-recharge-dialog", () => ({
  CommunityRechargeDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Recharge form</div> : null,
}));

const requirement = { key: "node:paid", communityPointPrice: 3, title: { "en-US": "Paid scene" } };
const runtime = {
  gameId: "game",
  buildId: "build",
  localization: { defaultLocale: "en-US" },
} as ExperienceRuntimeManifest;
let root: Root, container: HTMLDivElement, client: QueryClient;
let access: ReturnType<typeof useStoryCommunityAccess>["access"];
function Harness() {
  const commerce = useStoryCommunityAccess(runtime, "en-US");
  useEffect(() => {
    access = commerce.access;
  }, [commerce.access]);
  return commerce.dialog;
}
function quote(balance = "10") {
  return { requirements: [requirement], ownedKeys: [], authenticated: true, balance };
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === label
  );
  expect(button).toBeTruthy();
  await act(async () => {
    button!.click();
  });
  await settle();
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(quote());
  mocks.post.mockResolvedValue({});
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

it("charges only after confirmation and releases the pending operation on success", async () => {
  let result!: Promise<boolean>;
  await act(async () => {
    result = access.requestAccess(requirement);
  });
  await settle();
  expect(mocks.post).not.toHaveBeenCalled();
  await click("unlock");
  expect(await result).toBe(true);
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(mocks.post).toHaveBeenCalledWith(expect.any(String), {
    data: { key: requirement.key, expectedPrice: 3 },
  });
  expect(access.canAccess(requirement)).toBe(true);
});

it("keeps content locked on failure and offers recharge after a balance refresh", async () => {
  await act(async () => {
    void access.requestAccess(requirement);
  });
  await settle();
  mocks.post.mockRejectedValue(new Error("Insufficient Community Points"));
  mocks.get.mockResolvedValue(quote("0"));
  await click("unlock");
  expect(access.canAccess(requirement)).toBe(false);
  expect(document.body.textContent).toContain("Insufficient Community Points");
  await click("recharge");
  expect(document.body.textContent).toContain("Recharge form");
});

it("cancels without any debit", async () => {
  let result!: Promise<boolean>;
  await act(async () => {
    result = access.requestAccess(requirement);
  });
  await settle();
  await click("cancel");
  expect(await result).toBe(false);
  expect(mocks.post).not.toHaveBeenCalled();
});

it("loads permanent ownership without opening a dialog or charging again", async () => {
  mocks.get.mockResolvedValue({ ...quote(), ownedKeys: [requirement.key] });
  expect(access.canAccess(requirement)).toBe(false);
  let allowed = false;
  await act(async () => {
    allowed = await access.checkAccess!(requirement);
  });
  expect(allowed).toBe(true);
  expect(access.canAccess(requirement)).toBe(true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.post).not.toHaveBeenCalled();
});

it("keeps lookup failures locked and exposes the server error with retry", async () => {
  mocks.get.mockRejectedValue(new Error("Story access service unavailable"));
  await act(async () => {
    expect(await access.checkAccess!(requirement)).toBe(false);
    void access.requestAccess(requirement);
  });
  await settle();
  expect(document.body.textContent).toContain("Story access service unavailable");
  expect(access.canAccess(requirement)).toBe(false);
  mocks.get.mockResolvedValue({ ...quote(), ownedKeys: [requirement.key] });
  await click("retry");
  expect(access.canAccess(requirement)).toBe(true);
  expect(mocks.post).not.toHaveBeenCalled();
});
