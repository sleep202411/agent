// @vitest-environment jsdom
import { act, useSyncExternalStore, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type { CreatorDiscoveryRequest } from "@repo/shared/creator-location";
import type {
  GpsMapFactory,
  GpsMapOptions,
  GpsMapFeature,
} from "../../ips/_data/content-gps-map-types";
import { StudioDiscovery } from "./studio-discovery";
import { api, ApiRequestError, type ApiRequestConfig } from "@/src/lib/api";
import en from "@/messages/en-US.json";
import { encodeUserId } from "@/src/lib/user-id-codec";
const context = vi.hoisted(() => ({
  viewer: "viewer" as string | null,
  locale: "en-US",
  params: "",
  login: vi.fn(),
  push: vi.fn(),
  listeners: new Set<() => void>(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(
      useSyncExternalStore(
        (listener) => {
          context.listeners.add(listener);
          return () => {
            context.listeners.delete(listener);
          };
        },
        () => context.params
      )
    ),
  useRouter: () => ({ push: context.push, replace: context.push }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    prefetch,
    ...props
  }: {
    children: ReactNode;
    prefetch?: boolean;
    href: string;
  }) => {
    void prefetch;
    return <a {...props}>{children}</a>;
  },
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({
    user: context.viewer ? { id: context.viewer } : null,
    isLoading: false,
  }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: context.login }),
}));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => <span /> }));
vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({
    children,
    onChange,
    ...props
  }: {
    children: ReactNode;
    onChange: (v: string) => void;
  }) => (
    // eslint-disable-next-line no-restricted-syntax -- Test double; browser coverage uses the actual Radix select.
    <select {...props} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  ),
  NativeSelectOption: (props: object) => <option {...props} />,
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => context.locale,
  useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) => {
    let value: unknown = (en as Record<string, unknown>)[ns];
    for (const part of key.split(".")) value = (value as Record<string, unknown>)[part];
    return String(value ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
      String(values?.[name] ?? "")
    );
  },
}));
vi.mock("@/src/lib/api", () => ({
  api: { post: vi.fn() },
  ApiRequestError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
const item = (id = "123", name = "Singapore animation studio") => ({
  id,
  name,
  avatarUrl: "",
  matched: true,
  openToWork: true,
  basedIn: { countryCode: "SG", city: "Singapore" },
  serves: [{ countryCode: "MY", city: "Johor Bahru" }],
  remote: true,
  showOnMap: true,
  point: null,
  serviceCount: 3,
  matchingServiceCount: 2,
});
const hash = "a".repeat(64);
function response(config: ApiRequestConfig, overrides = {}) {
  const input = config.data as CreatorDiscoveryRequest;
  return {
    requestId: input.requestId,
    queryId: hash,
    query: input.query,
    items: [item()],
    selected: input.selectedCreatorId ? item(input.selectedCreatorId) : null,
    map: input.map
      ? {
          viewport: input.map,
          creatorCount: 0,
          matchedCreatorCount: 0,
          clusters: [],
          scope: "visible_creator_results",
        }
      : null,
    nextCursor: null,
    matchedCount: 87,
    accessibleCount: 120,
    requiresLogin: false,
    island: { creatorCount: 0, matchedCreatorCount: 0 },
    countScope: "public_platform_creators_with_listed_services",
    ...overrides,
  };
}
let host: HTMLDivElement, root: Root, client: QueryClient;
const tick = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
async function render(factory?: GpsMapFactory) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <StudioDiscovery factory={factory} />
      </QueryClientProvider>
    )
  );
  await tick();
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
  await act(async () => button.click());
  await tick();
}
async function input(label: string, value: string) {
  const node = [...host.querySelectorAll("input,select")].find(
    (node) =>
      node.getAttribute("aria-label") === label ||
      node.closest("label")?.querySelector("span")?.textContent === label
  ) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
      "value"
    )!.set!.call(node, value);
    node.dispatchEvent(
      new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })
    );
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  sessionStorage.clear();
  context.viewer = "viewer";
  context.locale = "en-US";
  context.params = "";
  context.push.mockImplementation((url: string) => {
    context.params = url.split("?")[1] ?? "";
    context.listeners.forEach((listener) => listener());
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(api.post).mockImplementation(async (_path, config) => response(config!));
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllEnvs();
});
it("shows full scoped counts, distinct service areas, matching services and encoded profile links", async () => {
  await render();
  expect(host.textContent).toContain("87 matching studios on FizzDragon with published services");
  expect(host.textContent).toContain("Johor Bahru, Malaysia");
  expect(host.textContent).toContain("2 matching services");
  expect(
    [...host.querySelectorAll("a")].some((a) =>
      a.getAttribute("href")?.endsWith(`/creators/${encodeUserId("123")}#services`)
    )
  ).toBe(true);
});
it("submits locations, category, remote and availability only when applied", async () => {
  await render();
  await input("Based in: Country / region", "SG");
  await input("Based in: City", "Singapore");
  await input("Serves: Country / region", "MY");
  await input("Serves: City", "Johor Bahru");
  await input("Service title or tag", "advertising");
  await input("Service category", "video_production");
  await act(async () => {
    host
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .forEach((node) => node.click());
  });
  expect(api.post).toHaveBeenCalledTimes(2);
  await click("Search studios");
  await render();
  const last = vi.mocked(api.post).mock.calls.at(-1)![1]!.data as CreatorDiscoveryRequest;
  expect(last.query).toEqual({
    basedIn: { countryCode: "SG", city: "Singapore" },
    serves: { countryCode: "MY", city: "Johor Bahru" },
    remoteOnly: true,
    availableForWork: true,
    category: "video_production",
    text: "advertising",
  });
});
it("blocks incomplete locations and malformed URL filters without silently relaxing them", async () => {
  context.params = "basedCountry=SG&remote=maybe";
  await render();
  expect(api.post).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await click("Reset filters");
  await render();
  expect(api.post).toHaveBeenCalledTimes(2);
});
it("appends later pages with server counts and a query-bound cursor", async () => {
  vi.mocked(api.post).mockImplementation(async (_p, config) =>
    response(
      config!,
      (config!.data as CreatorDiscoveryRequest).cursor
        ? { items: [item("456", "Remote studio")], matchedCount: 86 }
        : { nextCursor: { afterId: "123", queryId: hash } }
    )
  );
  await render();
  await click("Load more studios");
  expect(host.textContent).toContain("Singapore animation studio");
  expect(host.textContent).toContain("Remote studio");
  expect(host.textContent).toContain("86 matching studios");
  expect(
    (vi.mocked(api.post).mock.calls.at(-1)![1]!.data as CreatorDiscoveryRequest).cursor
  ).toEqual({ afterId: "123", queryId: hash });
});
it("clears cached results on denied pagination and retries the search", async () => {
  vi.mocked(api.post).mockImplementation(async (_p, config) =>
    response(config!, { nextCursor: { afterId: "123", queryId: hash } })
  );
  await render();
  vi.mocked(api.post).mockRejectedValueOnce(
    new ApiRequestError("HTTP_403", "Search access revoked", 403)
  );
  await click("Load more studios");
  expect(host.textContent).not.toContain("Singapore animation studio");
  expect(host.textContent).toContain("Search access revoked");
  await click("Retry search");
  expect(host.textContent).toContain("Singapore animation studio");
});
it("retains earlier cards on a transient next-page failure but removes stale counts", async () => {
  vi.mocked(api.post).mockImplementation(async (_p, config) =>
    response(config!, { nextCursor: { afterId: "123", queryId: hash } })
  );
  await render();
  vi.mocked(api.post).mockRejectedValueOnce(new Error("Directory unavailable"));
  await click("Load more studios");
  expect(host.textContent).toContain("Singapore animation studio");
  expect(host.textContent).not.toContain("87 matching studios");
});
it("cancels a superseded query and ignores its late response", async () => {
  let finish!: (value: unknown) => void;
  let oldConfig!: ApiRequestConfig;
  vi.mocked(api.post).mockImplementationOnce((_p, config) => {
    oldConfig = config!;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await render();
  context.params = "text=music";
  vi.mocked(api.post).mockImplementation(async (_p, config) =>
    response(config!, { items: [item("456", "Music studio")] })
  );
  await render();
  expect(oldConfig.signal?.aborted).toBe(true);
  await act(async () => finish(response(oldConfig)));
  await tick();
  expect(host.textContent).toContain("Music studio");
  expect(host.textContent).not.toContain("Singapore animation studio");
});
it("isolates account/locale searches and preserves the query when opening guest login", async () => {
  context.viewer = null;
  context.params = "remote=1";
  vi.mocked(api.post).mockImplementation(async (_p, config) =>
    response(config!, { requiresLogin: true })
  );
  await render();
  expect(vi.mocked(api.post).mock.calls[0][1]!.credentials).toBe("omit");
  await click("Sign in");
  expect(context.login).toHaveBeenCalledWith();
  expect(context.params).toBe("remote=1");
  context.viewer = "new-account";
  context.locale = "zh-HK";
  await render();
  expect(vi.mocked(api.post).mock.calls.at(-1)![1]!.credentials).toBe("include");
  expect(
    [...host.querySelectorAll("a")].some((a) =>
      a.getAttribute("href")?.startsWith("/zh-HK/creators/")
    )
  ).toBe(true);
});
it("rejects a mismatched receipt before exposing its result", async () => {
  vi.mocked(api.post).mockImplementation(async (_p, config) =>
    response(config!, { requestId: crypto.randomUUID() })
  );
  await render();
  expect(host.textContent).toContain("does not match this request");
  expect(host.textContent).not.toContain("Singapore animation studio");
});
it("removes withdrawn results and consented cities after revalidation", async () => {
  await render();
  vi.mocked(api.post).mockImplementation(async (_p, config) =>
    response(config!, { items: [], matchedCount: 0 })
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["creator-studio-search"] });
  });
  await tick();
  expect(host.textContent).not.toContain("Singapore animation studio");
  expect(host.textContent).toContain("No studios match");
});

function mapFixture() {
  vi.stubEnv("NEXT_PUBLIC_CONTENT_GPS_MAP_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_SITE_REGION", "global");
  vi.stubEnv("NEXT_PUBLIC_CONTENT_GPS_GOOGLE_KEY", "fixture");
  vi.stubEnv("NEXT_PUBLIC_CONTENT_GPS_GOOGLE_MAP_ID", "fixture");
  const features: GpsMapFeature[][] = [];
  let options!: GpsMapOptions;
  const factory: GpsMapFactory = (input) => {
    options = input;
    return Promise.resolve({
      setFeatures: (next) => {
        features.push(next);
      },
      zoomBy: () => {},
      focus: () => {},
      destroy: () => {},
    });
  };
  return {
    factory,
    features,
    get options() {
      return options;
    },
  };
}
const point = {
  latitude: 1.3,
  longitude: 103.8,
  coordinateSystem: "WGS84",
  precision: "city",
  provider: "google",
  providerPlaceId: "sg",
};
function pinnedResponse(config: ApiRequestConfig, revoked = false) {
  const input = config.data as CreatorDiscoveryRequest;
  return response(config, {
    items: revoked ? [] : [{ ...item(), point }],
    selected:
      input.selectedCreatorId && !revoked ? { ...item(input.selectedCreatorId), point } : null,
    map: input.map
      ? {
          viewport: input.map,
          creatorCount: revoked ? 0 : 1,
          matchedCreatorCount: revoked ? 0 : 1,
          clusters: revoked
            ? []
            : [
                {
                  cell: "15:5",
                  matched: true,
                  count: 1,
                  creatorId: "123",
                  latitude: 1.3,
                  longitude: 103.8,
                },
              ],
          scope: "visible_creator_results",
        }
      : null,
  });
}
it("synchronizes card and map selection while panning leaves query and card pagination unchanged", async () => {
  const map = mapFixture();
  vi.mocked(api.post).mockImplementation(async (_p, config) => pinnedResponse(config!));
  await render(map.factory);
  expect(map.features.at(-1)?.filter((feature) => !feature.virtualDestination)).toMatchObject([
    { entityId: "123", selected: false },
  ]);
  await click("Select studio");
  expect(host.querySelector("aside")!.textContent).toContain("Singapore animation studio");
  expect(map.features.at(-1)?.filter((feature) => !feature.virtualDestination)).toMatchObject([
    { entityId: "123", selected: true },
  ]);
  await click("Clear selection");
  await act(async () => map.options.onActivate(map.features.at(-1)![0]));
  await tick();
  expect(host.querySelector("aside")!.textContent).toContain("Singapore animation studio");
  const listCalls = () =>
    vi.mocked(api.post).mock.calls.filter((call) => !(call[1]!.data as CreatorDiscoveryRequest).map)
      .length;
  const before = listCalls();
  await act(async () =>
    map.options.onViewport({ coordinateSystem: "WGS84", west: 100, east: 110, south: 0, north: 10 })
  );
  await tick();
  expect(listCalls()).toBe(before);
  expect(context.params).toBe("selected=123");
});
it("removes revoked selection from pins, details and cached cards even after selection is cleared", async () => {
  const map = mapFixture();
  let revoked = false;
  vi.mocked(api.post).mockImplementation(async (_p, config) => pinnedResponse(config!, revoked));
  await render(map.factory);
  revoked = true;
  await click("Select studio");
  expect(host.querySelector("aside")!.textContent).toContain("no longer available");
  expect(map.features.at(-1)?.filter((feature) => !feature.virtualDestination)).toEqual([]);
  await click("Clear selection");
  expect(host.textContent).not.toContain("Singapore animation studio");
});
it("keeps cards usable on map query failure and clears the old pins", async () => {
  const map = mapFixture();
  vi.mocked(api.post).mockImplementation(async (_p, config) => pinnedResponse(config!));
  await render(map.factory);
  vi.mocked(api.post).mockImplementation(async (_p, config) => {
    if ((config!.data as CreatorDiscoveryRequest).map) throw new Error("Map query unavailable");
    return pinnedResponse(config!);
  });
  await act(async () =>
    map.options.onViewport({ coordinateSystem: "WGS84", west: 100, east: 110, south: 0, north: 10 })
  );
  await tick();
  expect(host.textContent).toContain("Map query unavailable");
  expect(host.textContent).toContain("Singapore animation studio");
  expect(map.features.at(-1)?.filter((feature) => !feature.virtualDestination)).toEqual([]);
});

it("applies creator recommendations with distinct location rules and preserves the conversation", async () => {
  const requests: {
    requestId: string;
    conversation: { current: { query: unknown }; messages: { content: string }[] };
  }[] = [];
  const query = {
    text: "animation",
    category: null,
    basedIn: { countryCode: "SG", city: "Singapore" },
    serves: { countryCode: "MY", city: "Johor Bahru" },
    remoteOnly: true,
    availableForWork: true,
  };
  vi.mocked(api.post).mockImplementation(async (path, config) => {
    if (path === "/aurora/content-gps/discovery/requests") {
      const request = config!.data as (typeof requests)[number];
      requests.push(request);
      return {
        requestId: request.requestId,
        status: "succeeded",
        result: {
          status: "results",
          kind: "creators",
          query,
          queryId: hash,
          cards: [item()],
          matchedCount: 1,
          accessibleCount: 2,
          requiresLogin: false,
          countScope: "public_platform_creators_with_listed_services",
        },
      };
    }
    return response(config!);
  });
  await render();
  const send = async (value: string) => {
    await act(async () => {
      const node = host.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        node,
        value
      );
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(en.discoveryAssistant.send);
  };
  await send("Find a local animation studio");
  expect(context.push).not.toHaveBeenCalled();
  expect(host.textContent).toContain(en.discoveryAssistant.proposal);
  await click(en.discoveryAssistant.showOnMap);
  expect(new URLSearchParams(context.params).get("selected")).toBe("123");
  expect(new URLSearchParams(context.params).get("basedCity")).toBe("Singapore");
  expect(new URLSearchParams(context.params).get("servesCity")).toBe("Johor Bahru");
  expect(host.querySelector("aside")!.textContent).toContain("Singapore animation studio");
  await send("Keep those service areas");
  expect(requests[1]!.conversation.current.query).toEqual(query);
  expect(requests[1]!.conversation.messages[0]!.content).toBe("Find a local animation studio");
});
it("blocks conversation dispatch when edited search criteria are invalid", async () => {
  await render();
  await input(en.studioDiscovery.text, "x".repeat(121));
  await act(async () => {
    const node = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      node,
      "Find studios"
    );
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const send = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === en.discoveryAssistant.send
  )!;
  expect(send.disabled).toBe(true);
  expect(host.textContent).toContain(en.discoveryAssistant.invalidConditions);
  expect(
    vi
      .mocked(api.post)
      .mock.calls.some(([path]) => path === "/aurora/content-gps/discovery/requests")
  ).toBe(false);
});

it("opens the server-counted virtual island without selecting a creator", async () => {
  context.params = "basedCountry=SG&basedCity=Singapore&text=animation";
  vi.mocked(api.post).mockImplementation(async (_path, config) =>
    response(config!, { island: { creatorCount: 87, matchedCreatorCount: 12 } })
  );
  const map = mapFixture();
  await render(map.factory);
  const island = host.querySelector<HTMLAnchorElement>(
    `a[aria-label="${en.studioDiscovery.islandBrowse}"]`
  )!;
  expect(island).toBeTruthy();
  expect(island.textContent).toContain("FizzDragon Island");
  expect(island.textContent).toContain("12");
  const params = new URL(island.href, "https://example.test").searchParams;
  expect(params.get("location")).toBe("island");
  expect(params.get("basedCountry")).toBeNull();
  expect(params.get("text")).toBe("animation");
  const anchor = map.features
    .at(-1)!
    .find((feature) => feature.virtualDestination === "fizzdragon-island")!;
  expect(anchor).toMatchObject({ latitude: -25, longitude: -140, entityId: null });
  expect(anchor.label).toContain(en.studioDiscovery.islandDescription);
  await act(async () => map.options.onActivate(anchor));
  expect(context.push).toHaveBeenCalledWith(island.getAttribute("href"), { scroll: false });
});

it("opens service-free island creators through their profile without advertising a service", async () => {
  context.params = "location=island";
  vi.mocked(api.post).mockImplementation(async (_path, config) =>
    response(config!, {
      items: [
        { ...item(), showOnMap: false, basedIn: null, serviceCount: 0, matchingServiceCount: 0 },
      ],
      countScope: "public_platform_creators",
      island: { creatorCount: 1, matchedCreatorCount: 1 },
      matchedCount: 1,
      accessibleCount: 1,
    })
  );
  await render();
  expect(host.querySelector("h1")?.textContent).toBe("FizzDragon Island");
  const profile = [...host.querySelectorAll<HTMLAnchorElement>("a")].find(
    (link) => link.textContent === en.studioDiscovery.viewCreator
  )!;
  expect(profile).toBeTruthy();
  expect(profile.getAttribute("href")).not.toContain("#services");
  expect(host.querySelector("article")?.textContent).not.toContain("0 matching services");
});

it("links signed-in Island visitors to their own location controls and removes the link on logout", async () => {
  context.params = "location=island";
  await render();
  const locationLink = () => host.querySelector('a[href="/en-US/profile/services"]');
  expect(locationLink()?.textContent).toContain(en.studioDiscovery.manageLocation);
  context.viewer = null;
  await render();
  expect(locationLink()).toBeNull();
});
