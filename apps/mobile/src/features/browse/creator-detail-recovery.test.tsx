import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import CreatorDetail from "@/app/creator/[id]";
const h = vi.hoisted(() => ({
  t: (k: string) => k,
  active: true,
  generation: 1,
  locale: "en-US",
  id: "a",
  section: undefined as string | string[] | undefined,
  scrollTo: vi.fn(),
  layouts: [] as ((event: any) => void)[],
  scrollProps: {} as any,
  profile: vi.fn(),
  services: vi.fn(),
  works: vi.fn(),
  crews: vi.fn(),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: "authenticated", generation: h.generation }),
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: h.id, section: h.section }),
}));
vi.mock("@/features/certificates/creator-certificates", () => ({
  CreatorCertificates: () => null,
}));
vi.mock("@/features/studios/public-studio-profile", () => ({
  PublicStudioProfile: ({ children, header }: any) => (
    <>
      {header}
      {children}
    </>
  ),
}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("@/data/browse-service", () => ({
  getCreatorById: h.profile,
  getCreatorIps: h.works,
  getCrewsByUser: h.crews,
}));
vi.mock("@/data/creator-service-api", () => ({
  InvalidCreatorServicesPageError: class extends Error {},
  fetchCreatorServicesPage: async (...args: unknown[]) => {
    const value = await h.services(...args);
    return Array.isArray(value) ? { items: value, nextCursor: null } : value;
  },
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => h.t, useLocale: () => h.locale }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/themed-view", () => ({
  ThemedView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ip-grid", () => ({ IpGrid: () => <span>public IPs</span> }));
vi.mock("@/components/ui", () => ({
  EmptyState: ({ title }: { title: string }) => <span>{title}</span>,
  PosterImage: () => null,
  SectionHeader: () => null,
  Tag: () => null,
}));
vi.mock("@/features/profile/creator-personal-works", () => ({ CreatorPersonalWorks: () => null }));
vi.mock("@/features/profile/creator-experience", () => ({ CreatorExperience: () => null }));
vi.mock("@/features/profile/creator-education", () => ({ CreatorEducation: () => null }));
vi.mock("react-native", async () => {
  const { useImperativeHandle } = await import("react");
  return {
    View: ({ children, onLayout }: any) => {
      if (onLayout) h.layouts.push(onLayout);
      return <div>{children}</div>;
    },
    ScrollView: ({ children, ref, ...props }: any) => {
      useImperativeHandle(ref, () => ({ scrollTo: h.scrollTo }));
      h.scrollProps = props;
      return <div>{children}</div>;
    },
    ActivityIndicator: () => <span>loading</span>,
    StyleSheet: { create: (v: unknown) => v },
    Platform: { select: (v: Record<string, unknown>) => v.web ?? v.default },
    Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
      <button onClick={onPress}>{children}</button>
    ),
  };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = () => act(async () => root.render(<CreatorDetail />));
const retry = () =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "common.retry")!.click()
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.id = "a";
  h.active = true;
  h.generation = 1;
  h.locale = "en-US";
  h.section = undefined;
  h.layouts = [];
  h.profile.mockResolvedValue({ id: "a", name: "Alice", levels: [] });
  h.services.mockResolvedValue([]);
  h.works.mockResolvedValue([{ id: "ip" }]);
  h.crews.mockResolvedValue([]);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
});
it("shows a failed lookup as an error and retries the same creator", async () => {
  h.profile.mockRejectedValueOnce(new Error("Profile offline"));
  await render();
  expect(host.textContent).toContain("Profile offline");
  expect(host.textContent).not.toContain("notFound");
  await retry();
  expect(host.textContent).toContain("Alice");
  expect(h.profile).toHaveBeenLastCalledWith("a");
});
it("retains successful sections and does not mislabel a service failure as empty", async () => {
  h.services.mockRejectedValueOnce(new Error("Services offline"));
  await render();
  expect(host.textContent).toContain("Alice");
  expect(host.textContent).toContain("public IPs");
  expect(host.textContent).toContain("Services offline");
  expect(host.textContent).not.toContain("servicesEmpty");
  await retry();
  expect(host.textContent).not.toContain("Services offline");
  expect(host.textContent).toContain("servicesEmpty");
});
it("keeps genuine missing profiles distinct from transport failures", async () => {
  h.profile.mockResolvedValue(undefined);
  await render();
  expect(host.textContent).toContain("notFoundTitle");
});
it("ignores a late profile after navigation to another creator", async () => {
  let finish!: (v: unknown) => void;
  h.profile.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  h.id = "b";
  h.profile.mockResolvedValue({ id: "b", name: "Bob", levels: [] });
  await render();
  await act(async () => finish({ id: "a", name: "Stale Alice", levels: [] }));
  expect(host.textContent).toContain("Bob");
  expect(host.textContent).not.toContain("Stale Alice");
});

it("shows the profile while a secondary section is still loading", async () => {
  let finish!: (v: unknown) => void;
  h.services.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  expect(host.textContent).toContain("Alice");
  expect(host.textContent).toContain("public IPs");
  expect(host.textContent).not.toContain("servicesEmpty");
  await act(async () => finish([]));
  expect(host.textContent).toContain("servicesEmpty");
});
it("exposes profile retry without waiting for a stalled secondary lookup", async () => {
  h.profile.mockRejectedValueOnce(Error("Profile offline"));
  h.services.mockImplementationOnce(() => new Promise(() => {}));
  await render();
  expect(host.textContent).toContain("Profile offline");
  await retry();
  expect(host.textContent).toContain("Alice");
});

it("does not attach a previous creator's late section error to the new profile", async () => {
  let fail!: (error: Error) => void;
  h.services.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      })
  );
  await render();
  expect(host.textContent).toContain("Alice");
  h.id = "b";
  h.profile.mockResolvedValue({ id: "b", name: "Bob", levels: [] });
  await render();
  await act(async () => fail(Error("Alice services failed")));
  expect(host.textContent).toContain("Bob");
  expect(host.textContent).not.toContain("Alice");
});

it("targets services after layout and follows delayed content until the user scrolls", async () => {
  h.section = "services";
  await render();
  const [body, services] = h.layouts.slice(-2);
  act(() => body({ nativeEvent: { layout: { y: 200 } } }));
  expect(h.scrollTo).not.toHaveBeenCalled();
  act(() => services({ nativeEvent: { layout: { y: 900 } } }));
  expect(h.scrollTo).toHaveBeenLastCalledWith({ y: 1044, animated: false });
  act(() => services({ nativeEvent: { layout: { y: 1100 } } }));
  expect(h.scrollTo).toHaveBeenLastCalledWith({ y: 1244, animated: false });
  act(() => h.scrollProps.onScrollBeginDrag());
  h.scrollTo.mockClear();
  act(() => {
    services({ nativeEvent: { layout: { y: 1400 } } });
    h.scrollProps.onContentSizeChange();
  });
  expect(h.scrollTo).not.toHaveBeenCalled();
});
it.each([undefined, "unknown", ["services", "services"]])(
  "does not scroll ordinary or invalid profile links: %s",
  async (section) => {
    h.section = section;
    await render();
    for (const callback of h.layouts.slice(-2))
      act(() => callback({ nativeEvent: { layout: { y: 900 } } }));
    act(() => h.scrollProps.onContentSizeChange());
    expect(h.scrollTo).not.toHaveBeenCalled();
  }
);

it("returns to services after a touch-triggered retry remounts the profile", async () => {
  h.section = "services";
  h.services.mockRejectedValueOnce(Error("Services offline"));
  await render();
  act(() => h.scrollProps.onTouchStart());
  await retry();
  const [body, services] = h.layouts.slice(-2);
  act(() => {
    body({ nativeEvent: { layout: { y: 200 } } });
    services({ nativeEvent: { layout: { y: 900 } } });
  });
  expect(h.scrollTo).toHaveBeenLastCalledWith({ y: 1044, animated: false });
});

it("loads more services once and preserves cards/cursor after failure", async () => {
  const service = (id: string) => ({
    id,
    creatorId: "a",
    title: id,
    summary: "",
    category: "other",
    tags: [],
    startingPrice: 10,
    currency: "USD",
    startingDeliveryDays: 2,
    packageCount: 1,
  });
  h.services
    .mockResolvedValueOnce({ items: [service("first")], nextCursor: "next" })
    .mockRejectedValueOnce(Error("Next page offline"))
    .mockResolvedValueOnce({ items: [service("second")], nextCursor: null });
  await render();
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "myServices.loadMore")!
      .click()
  );
  expect(host.textContent).toContain("first");
  expect(host.textContent).toContain("Next page offline");
  await retry();
  expect(h.services).toHaveBeenLastCalledWith("a", "next", expect.any(AbortSignal));
  expect(host.textContent).toContain("first");
  expect(host.textContent).toContain("second");
  expect(host.textContent).not.toContain("myServices.loadMore");
});

it("serializes more requests and ignores their late result after switching creator", async () => {
  h.services.mockResolvedValueOnce({ items: [], nextCursor: "next" });
  await render();
  let finish!: (value: unknown) => void;
  h.services.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => {
    const button = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "myServices.loadMore"
    )!;
    button.click();
    button.click();
  });
  expect(h.services).toHaveBeenCalledTimes(2);
  const signal = h.services.mock.calls[1][2] as AbortSignal;
  h.id = "b";
  h.profile.mockResolvedValue({ id: "b", name: "Bob", levels: [] });
  h.services.mockResolvedValue([]);
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ items: [], nextCursor: "stale" }));
  expect(host.textContent).toContain("Bob");
  expect(host.textContent).not.toContain("myServices.loadMore");
});

it("reloads the profile and services after a return visit", async () => {
  await render();
  expect(host.textContent).toContain("Alice");
  const signal = h.services.mock.calls[0][2] as AbortSignal;
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
  expect(signal.aborted).toBe(true);
  h.profile.mockResolvedValue({ id: "a", name: "Updated Alice", levels: [] });
  h.active = true;
  await render();
  expect(h.profile).toHaveBeenCalledTimes(2);
  expect(h.services).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("Updated Alice");
});
it.each(["account", "locale"])("isolates pending profile data after %s changes", async (mode) => {
  let finish!: (value: unknown) => void;
  h.profile.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  if (mode === "account") h.generation++;
  else h.locale = "zh-CN";
  h.profile.mockResolvedValue({ id: "a", name: "Current profile", levels: [] });
  await render();
  await act(async () => finish({ id: "a", name: "Stale profile", levels: [] }));
  expect(host.textContent).toContain("Current profile");
  expect(host.textContent).not.toContain("Stale profile");
});
