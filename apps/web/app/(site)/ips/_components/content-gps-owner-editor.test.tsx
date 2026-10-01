// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { ContentGpsOwnerEditor } from "./content-gps-owner-editor";
import { api, ApiRequestError } from "@/src/lib/api";
const account = vi.hoisted(() => ({ id: "owner" }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: account.id } }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/lib/api", () => ({
  api: { get: vi.fn(), put: vi.fn() },
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
let client: QueryClient;
let host: HTMLDivElement;
let root: Root;
const ipId = "01900000-0000-7000-8000-000000000001";
const location = {
  id: "01900000-0000-7000-8000-000000000002",
  kind: "story_setting",
  label: "Singapore",
  status: "resolved",
  point: { latitude: 1.3, longitude: 103.8, coordinateSystem: "WGS84", precision: "city" },
};
const initial = {
  version: 1,
  locations: [location],
  requestId: "01900000-0000-7000-8000-000000000003",
};
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((node) => node.textContent === text)!;
async function render(ownerId = "owner") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ContentGpsOwnerEditor ipId={ipId} ownerId={ownerId} />
      </QueryClientProvider>
    )
  );
}
async function submit() {
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  account.id = "owner";
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(api.get).mockResolvedValue(initial);
  vi.mocked(api.put).mockResolvedValue({ version: 2 });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  client.clear();
});
it("does not request owner data for an editor or missing owner identity", async () => {
  await render("other");
  expect(host.textContent).toBe("");
  expect(api.get).not.toHaveBeenCalled();
  await render("");
  expect(api.get).not.toHaveBeenCalled();
});
it("reuses the exact persisted request after a lost reply and remount", async () => {
  vi.mocked(api.put).mockRejectedValueOnce(new Error("Connection lost"));
  await render();
  await submit();
  const first = vi.mocked(api.put).mock.calls[0]![1]!.data;
  expect(host.textContent).toContain("Connection lost");
  expect(host.querySelector("fieldset")!.disabled).toBe(true);
  act(() => root.unmount());
  root = createRoot(host);
  await render();
  expect(button("retrySave")).toBeTruthy();
  await submit();
  expect(vi.mocked(api.put).mock.calls[1]![1]!.data).toEqual(first);
  expect(sessionStorage.length).toBe(0);
  expect(host.textContent).toContain("saved");
});
it("reads latest after replay instead of adopting an older receipt", async () => {
  await render();
  vi.mocked(api.get).mockResolvedValueOnce({
    ...initial,
    version: 8,
    locations: [{ ...location, label: "Latest owner correction" }],
  });
  await submit();
  expect(host.querySelector("input")!.value).toBe("Latest owner correction");
  await submit();
  expect(vi.mocked(api.put).mock.calls[1]![1]!.data).toMatchObject({ expectedVersion: 8 });
});
it("retains edits on conflict and requires explicit loading of latest", async () => {
  vi.mocked(api.put).mockRejectedValueOnce(
    new ApiRequestError("CONFLICT", "Changed elsewhere", 409)
  );
  await render();
  await submit();
  expect(host.querySelector("input")!.value).toBe("Singapore");
  expect(button("save").disabled).toBe(true);
  vi.mocked(api.get).mockResolvedValueOnce({ ...initial, version: 3, locations: [] });
  await act(async () => button("discard").click());
  expect(host.querySelectorAll("input")).toHaveLength(0);
  expect(button("save").disabled).toBe(false);
});
it("clears private fields when owner access is revoked", async () => {
  vi.mocked(api.put).mockRejectedValueOnce(new ApiRequestError("NOT_FOUND", "IP not found.", 404));
  await render();
  await submit();
  expect(host.querySelector("form")).toBeNull();
  expect(sessionStorage.length).toBe(0);
  expect(host.textContent).toContain("IP not found.");
});
it("preserves empty override and never turns blank coordinates into zero", async () => {
  await render();
  await act(async () => {
    const input = host.querySelectorAll("input")[1]!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await submit();
  expect(api.put).not.toHaveBeenCalled();
  expect(host.textContent).toContain("invalid");
  await act(async () => button("remove").click());
  await submit();
  expect(vi.mocked(api.put).mock.calls[0]![1]!.data).toMatchObject({ locations: [] });
});
it("prevents duplicate dispatch and ignores replies after an account change", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api.put).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  act(() => {
    for (let n = 0; n < 2; n++)
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(api.put).toHaveBeenCalledTimes(1);
  const signal = vi.mocked(api.put).mock.calls[0]![1]!.signal!;
  account.id = "other";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ version: 2 }));
  expect(host.textContent).toBe("");
});
it("does not send if durable retry storage is unavailable", async () => {
  await render();
  const storage = sessionStorage;
  vi.stubGlobal("sessionStorage", {
    getItem: storage.getItem.bind(storage),
    removeItem: storage.removeItem.bind(storage),
    setItem: () => {
      throw new Error("Storage unavailable");
    },
  });
  try {
    await submit();
    expect(api.put).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Storage unavailable");
  } finally {
    vi.unstubAllGlobals();
  }
});
const suggestions = {
  state: "ready",
  analysisVersion: "v1",
  analyzedAt: "2026-10-01T00:00:00Z",
  ownerVersion: 1,
  locations: [
    {
      id: "location:0",
      kind: "story_setting",
      label: "Hong Kong",
      status: "unresolved",
      point: null,
      evidence: [
        { sourceType: "ip_localization", field: "summary", quote: "A story in Hong Kong" },
      ],
    },
  ],
};
it("loads owner suggestions without a write and explicitly appends to the draft without replacing corrections", async () => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/suggestions") ? suggestions : initial
  );
  await render();
  await act(async () => button("load").click());
  expect(host.textContent).toContain("A story in Hong Kong");
  expect(api.put).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>("article button")!.click());
  const labels = [...host.querySelectorAll<HTMLInputElement>('input[maxlength="300"]')].map(
    (input) => input.value
  );
  expect(labels).toEqual(["Singapore", "Hong Kong"]);
  expect(host.querySelector<HTMLButtonElement>("article button")!.disabled).toBe(true);
  await submit();
  const body = vi.mocked(api.put).mock.calls[0][1]!.data as { locations: (typeof location)[] };
  expect(body.locations[0]).toEqual(location);
  expect(body.locations[1]).toMatchObject({
    label: "Hong Kong",
    status: "unresolved",
    point: null,
  });
});
it("does not add suggestions against an obsolete owner version", async () => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/suggestions") ? { ...suggestions, ownerVersion: 2 } : initial
  );
  await render();
  await act(async () => button("load").click());
  expect(host.textContent).toContain("ownerChanged");
  expect(host.querySelector<HTMLButtonElement>("article button")!.disabled).toBe(true);
});
it("withdrawn analysis clears the earlier quotes and ownership denial clears the editor", async () => {
  let response: unknown = suggestions;
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (!path.endsWith("/suggestions")) return initial;
    if (response instanceof Error) throw response;
    return response;
  });
  await render();
  await act(async () => button("load").click());
  response = { ...suggestions, state: "missing", locations: [], analyzedAt: null };
  await act(async () => button("load").click());
  expect(host.textContent).not.toContain("A story in Hong Kong");
  response = new ApiRequestError("NOT_FOUND", "IP not found", 404);
  await act(async () => button("load").click());
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).toContain("IP not found");
});
