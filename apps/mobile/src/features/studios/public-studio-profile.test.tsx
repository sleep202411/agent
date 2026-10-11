import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { ApiRequestError } from "@/lib/api-client";
import { PublicStudioProfile } from "./public-studio-profile";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  generation: 1,
  active: true,
  signedIn: false,
  hydrating: false,
  t: (key: string) => key,
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.hydrating ? "hydrating" : h.signedIn ? "authenticated" : "anonymous",
    generation: h.generation,
  }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({ useLocale: () => "en-US", useTranslations: () => h.t }));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get },
  ApiRequestError: class extends Error {
    constructor(
      _code: number,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: any) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({ children, onPress }: any) => <button onClick={onPress}>{children}</button>,
}));
const profile = {
  id: "artist",
  name: "Artist",
  avatarUrl: "",
  openToWork: true,
  matched: true,
  basedIn: { countryCode: "SG", city: "Singapore" },
  serves: [{ countryCode: "JP", city: "Tokyo" }],
  remote: true,
  showOnMap: true,
  point: null,
  serviceCount: 2,
  matchingServiceCount: 2,
};
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const render = (id = "artist") =>
  act(async () =>
    root.render(
      <PublicStudioProfile creatorId={id} header={<span>Services</span>}>
        <span>Service cards</span>
      </PublicStudioProfile>
    )
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.signedIn = false;
  h.hydrating = false;
  h.get.mockResolvedValue(profile);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("loads the official guest projection and displays public geography beside services", async () => {
  await render();
  expect(h.get).toHaveBeenCalledWith(
    "/creator-location/profiles/artist",
    expect.objectContaining({ credentials: "omit", retry: false, service: "aurora" })
  );
  expect(host.textContent).toContain("Singapore");
  expect(host.textContent).toContain("Tokyo");
  expect(host.textContent).toContain("creatorStudio.remote");
  expect(host.textContent).toContain("Service cards");
});
it("never displays a hidden base city", async () => {
  h.get.mockResolvedValue({
    ...profile,
    showOnMap: false,
    basedIn: { countryCode: "SG", city: "Private city" },
    serves: [],
    remote: false,
  });
  await render();
  expect(host.textContent).not.toContain("Private city");
  expect(host.textContent).not.toContain("creatorStudio.serves");
  expect(host.textContent).toContain("Service cards");
});
it("keeps independent public services when optional location metadata is absent", async () => {
  h.get.mockRejectedValue(new ApiRequestError(404, "Not found", 404));
  await render();
  expect(host.textContent).toContain("Service cards");
});
it("shows the upstream error and retries without claiming the studio is absent", async () => {
  h.get.mockRejectedValueOnce(Error("Profile unavailable"));
  await render();
  expect(host.textContent).toContain("Profile unavailable");
  expect(host.textContent).toContain("Service cards");
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("Service cards");
});
it.each([
  { ...profile, id: "other" },
  { ...profile, serves: "bad" },
])("rejects mismatched or malformed profile data", async (value) => {
  h.get.mockResolvedValue(value);
  await render();
  expect(host.textContent).toContain("contentGpsDiscovery.responseMismatch");
  expect(host.textContent).toContain("Service cards");
});
it("aborts on background and rechecks permissions on return", async () => {
  await render();
  const signal = h.get.mock.calls[0][1].signal;
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  expect(host.textContent).toBe("");
  h.active = true;
  h.get.mockRejectedValue(new ApiRequestError(404, "Not found", 404));
  await render();
  expect(host.textContent).toContain("Service cards");
  expect(h.get).toHaveBeenCalledTimes(2);
});
it("ignores a late previous-account projection", async () => {
  let finish!: (v: unknown) => void;
  h.get.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  h.generation++;
  h.signedIn = true;
  h.get.mockResolvedValue({ ...profile, showOnMap: false, serves: [], remote: false });
  await render();
  await act(async () => finish(profile));
  expect(host.textContent).not.toContain("Singapore");
  expect(h.get).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({ credentials: "include" })
  );
});

it("waits for session hydration before requesting the public projection", async () => {
  h.hydrating = true;
  await render();
  expect(h.get).not.toHaveBeenCalled();
  expect(host.textContent).toBe("");
  h.hydrating = false;
  await render();
  expect(host.textContent).toContain("Service cards");
});
