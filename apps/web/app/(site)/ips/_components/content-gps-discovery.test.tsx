// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type { ContentGpsSearchRequest } from "@repo/shared/content-gps";
import { ContentGpsDiscovery } from "./content-gps-discovery";
import { api, type ApiRequestConfig } from "@/src/lib/api";
import en from "@/messages/en-US.json";

const context = vi.hoisted(() => ({
  viewer: "viewer" as string | null,
  locale: "en-US",
  params: "",
  login: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(context.params),
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
  api: { post: vi.fn(), get: vi.fn() },
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
vi.mock("./content-gps-map", () => ({
  ContentGpsMap: ({
    onSelect,
    onViewport,
    features,
  }: {
    onSelect: (id: string) => void;
    onViewport: (v: object) => void;
    features: object[];
  }) => (
    <div>
      <span data-pins>{features.length}</span>
      <button onClick={() => onSelect(id)}>Map select</button>
      <button
        onClick={() =>
          onViewport({ coordinateSystem: "WGS84", west: 100, east: 110, south: 0, north: 10 })
        }
      >
        Pan
      </button>
    </div>
  ),
}));
const id = "10000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const item = {
  id,
  creatorId: "owner",
  roomNumber: "123456",
  title: "Singapore story",
  summary: "A public story",
  coverUrl: null,
  matched: true,
  locationSource: "owner",
  locations: [
    {
      id: "sg",
      kind: "story_setting",
      label: "Singapore",
      placeId: "label:singapore",
      status: "unresolved",
      point: null,
    },
  ],
  eras: [],
  episode: { id, durationSeconds: 900 },
};
function response(config: ApiRequestConfig, overrides = {}) {
  const input = config.data as ContentGpsSearchRequest;
  return {
    requestId: input.requestId,
    queryId: hash,
    query: input.query,
    mapScope: input.map,
    items: [item],
    selected: input.selectedIpId ? item : null,
    nextCursor: null,
    matchedCount: 1,
    accessibleCount: 2,
    countScope: "accessible_ips_with_published_translation",
    mapIpCount: 0,
    mapMatchedIpCount: 0,
    places: [{ id: "label:singapore", label: "Singapore", kind: "story_setting", ipCount: 1 }],
    placeCount: 1,
    placesTruncated: false,
    clusters: [],
    ...overrides,
  };
}
let root: Root, host: HTMLDivElement, client: QueryClient;
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ContentGpsDiscovery />
      </QueryClientProvider>
    )
  );
  await settle();
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((button) => button.textContent === text);
  expect(button).toBeTruthy();
  await act(async () => button!.click());
  await render();
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
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(api.get).mockResolvedValue({ items: [{ code: "romance", label: "Romance" }] });
  vi.mocked(api.post).mockImplementation(async (_url, config) => response(config!));
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
it("renders canonical details and scopes counts without inventing a pin for an unknown location", async () => {
  await render();
  expect(host.textContent).toContain("1 matches among 2 accessible IPs");
  expect(host.querySelector('a[href="/en-US/ip/123456"]')).toBeTruthy();
  expect(host.querySelector("[data-pins]")?.textContent).toBe("0");
  await click("Map select");
  expect(host.textContent).toContain("Episode: 900 seconds");
  expect([...host.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toContain(
    `/en-US/tv?ip=${id}&episode=${id}`
  );
  expect(host.textContent).toContain("Matches your conditions");
});
it("panning changes only the overview viewport and preserves the list query", async () => {
  await render();
  const before = vi.mocked(api.post).mock.calls.length;
  await click("Pan");
  const newCalls = vi
    .mocked(api.post)
    .mock.calls.slice(before)
    .map(([, config]) => config!.data as ContentGpsSearchRequest);
  expect(newCalls.length).toBeGreaterThan(0);
  expect(
    newCalls.every(
      (request) =>
        request.limit === 1 && request.map.west === 100 && request.query.location === null
    )
  ).toBe(true);
  expect(host.textContent).toContain("Singapore story");
});
it("clears stale cards and match assertions on a failed background refresh", async () => {
  await render();
  await click("Map select");
  vi.mocked(api.post).mockRejectedValue(new Error("Search service unavailable"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["content-gps-cards"] });
  });
  await settle();
  expect(host.textContent).toContain("Search service unavailable");
  expect(host.querySelector('a[href="/en-US/ip/123456"]')).toBeNull();
  expect(host.textContent).not.toContain("Matches your conditions");
});
it("account replacement cannot show an old account's delayed response", async () => {
  let release!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementationOnce(
    (_url, config) =>
      new Promise((resolve) => {
        release = () =>
          resolve(response(config!, { items: [{ ...item, title: "Old private result" }] }));
      })
  );
  await render();
  context.viewer = null;
  await render();
  release(undefined);
  await settle();
  expect(host.textContent).not.toContain("Old private result");
  expect(vi.mocked(api.post).mock.calls.some(([, config]) => config?.credentials === "omit")).toBe(
    true
  );
});
it("a revoked selection is removed even while the authorized list remains available", async () => {
  await render();
  await click("Map select");
  vi.mocked(api.post).mockImplementation(async (_url, config) =>
    response(config!, { selected: null })
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["content-gps-overview"] });
  });
  await settle();
  expect(host.textContent).toContain("This IP is no longer available");
  expect(host.textContent).not.toContain("Episode: 900 seconds");
  await click("Clear selection");
  expect(host.querySelector('a[href="/en-US/ip/123456"]')).toBeNull();
});
it("invalid URL criteria do not issue a search", async () => {
  context.params = "from=2000";
  await render();
  expect(host.textContent).toContain("Choose a valid year range");
  expect(api.post).not.toHaveBeenCalled();
});
it("bookmark login preserves URL criteria and selection without a guest write", async () => {
  context.viewer = null;
  context.params = "seconds=900";
  await render();
  await click("Map select");
  await click("Bookmark IP");
  expect(context.login).toHaveBeenCalledTimes(1);
  const params = new URLSearchParams(context.params);
  expect(params.get("seconds")).toBe("900");
  expect(params.get("selected")).toBe(id);
  expect(vi.mocked(api.post).mock.calls.every(([url]) => url.endsWith("/search"))).toBe(true);
  expect(vi.mocked(api.get).mock.calls.every(([url]) => !url.endsWith("/collection"))).toBe(true);
});
it("reconciles a lost bookmark reply by reading before offering the opposite action", async () => {
  let saved = false;
  vi.mocked(api.get).mockImplementation(async (url) =>
    url.endsWith("/collection")
      ? { items: saved ? [{ targetType: "ip", status: "active", ipId: id }] : [] }
      : { items: [] }
  );
  vi.mocked(api.post).mockImplementation(async (url, config) => {
    if (url.endsWith("/search")) return response(config!);
    if (url.endsWith("/collection")) {
      saved = true;
      throw new Error("Write reply lost");
    }
    saved = false;
    return { item: null };
  });
  await render();
  await click("Map select");
  await click("Bookmark IP");
  expect(host.textContent).toContain("Write reply lost");
  expect(host.textContent).toContain("Remove bookmark");
  expect(
    vi.mocked(api.post).mock.calls.filter(([url]) => url.endsWith("/collection"))
  ).toHaveLength(1);
  await click("Remove bookmark");
  expect(saved).toBe(false);
  expect(host.textContent).toContain("Bookmark IP");
});
it("a failed collection read disables writes until a successful retry", async () => {
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url.endsWith("/collection")) throw new Error("Collection unavailable");
    return { items: [] };
  });
  await render();
  await click("Map select");
  expect(host.textContent).toContain("Collection unavailable");
  const button = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Bookmark IP"
  );
  expect(button?.disabled).toBe(true);
  vi.mocked(api.get).mockResolvedValue({ items: [] });
  await click("Retry");
  expect(
    [...host.querySelectorAll("button")].find((button) => button.textContent === "Bookmark IP")
      ?.disabled
  ).toBe(false);
});
it("account replacement cancels the old bookmark request and cannot restore its saved state", async () => {
  let finish!: (value: unknown) => void;
  let writeSignal: AbortSignal | undefined;
  vi.mocked(api.get).mockResolvedValue({ items: [] });
  vi.mocked(api.post).mockImplementation((url, config) => {
    if (url.endsWith("/search")) return Promise.resolve(response(config!));
    writeSignal = config?.signal ?? undefined;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await render();
  await click("Map select");
  await click("Bookmark IP");
  expect(host.textContent).toContain("Saving…");
  context.viewer = "replacement";
  await render();
  expect(writeSignal?.aborted).toBe(true);
  finish({ item: { status: "active", ipId: id } });
  await settle();
  expect(host.textContent).toContain("Bookmark IP");
  expect(host.textContent).not.toContain("Remove bookmark");
});

async function prompt(text: string) {
  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      textarea,
      text
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(en.discoveryAssistant.send);
}
it("proposes editable criteria, applies a selected recommendation, and retains follow-up context", async () => {
  const requests: {
    requestId: string;
    conversation: { current: { query: object }; messages: { content: string }[] };
  }[] = [];
  const query = {
    schemaVersion: 1,
    locale: "en-US",
    location: { kind: "story_setting", relation: "any", placeIds: ["label:singapore"] },
    era: {
      calendar: "proleptic_gregorian_astronomical",
      startYear: 1980,
      endYear: 2000,
      relation: "overlaps",
    },
    duration: { unit: "episode", maxSeconds: 900, unknown: "exclude" },
    genreCodes: ["romance"],
    moodPreferences: [],
  };
  vi.mocked(api.post).mockImplementation(async (url, config) => {
    if (url === "/aurora/content-gps/discovery/requests") {
      const request = config!.data as (typeof requests)[number];
      requests.push(request);
      return {
        requestId: request.requestId,
        status: "succeeded",
        result: {
          status: "results",
          kind: "ips",
          query,
          queryId: hash,
          cards: [item],
          matchedCount: 1,
          accessibleCount: 2,
          countScope: "accessible_ips_with_published_translation",
        },
      };
    }
    return response(config!);
  });
  await render();
  await prompt("Find short Singapore romances");
  expect(requests).toHaveLength(1);
  expect(context.push).not.toHaveBeenCalled();
  expect(host.textContent).toContain(en.discoveryAssistant.proposal);
  expect(host.textContent).not.toContain("label:singapore");
  await click(en.discoveryAssistant.showOnMap);
  expect(new URLSearchParams(context.params).get("selected")).toBe(id);
  expect(host.textContent).toContain("Find short Singapore romances");
  await prompt("Keep those conditions");
  expect(requests).toHaveLength(2);
  const { locale: ignored, ...criteria } = query;
  void ignored;
  expect(requests[1]!.conversation.current.query).toEqual(criteria);
  expect(requests[1]!.conversation.messages.map((message) => message.content)).toContain(
    "Find short Singapore romances"
  );
  context.viewer = "replacement";
  await render();
  expect(host.textContent).not.toContain("Find short Singapore romances");
});
it("keeps an oversized unsent prompt editable instead of discarding it", async () => {
  await render();
  const text = "x".repeat(2001);
  await prompt(text);
  expect(host.querySelector("textarea")!.value).toBe(text);
  expect(host.textContent).toContain(en.discoveryAssistant.invalid);
  expect(
    vi.mocked(api.post).mock.calls.some(([url]) => url === "/aurora/content-gps/discovery/requests")
  ).toBe(false);
});

// Relationship transport has its own selection/revocation suite. Keep these collection assertions scoped to their workflow.
vi.mock("./ip-contributing-studios", () => ({ IpContributingStudios: () => null }));
