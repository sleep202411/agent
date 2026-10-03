import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api-client";
import { CrewLinkedResources } from "./crew-linked-resources";
vi.mock("./crew-link-ip", () => ({ CrewLinkIp: () => <span>Link IP entry</span> }));
const h = vi.hoisted(() => ({
  status: "authenticated",
  generation: 1,
  active: true,
  ips: vi.fn(),
  workspace: vi.fn(),
  films: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({
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
vi.mock("./crew-linked-resources-api", () => ({
  fetchLinkedIps: h.ips,
  fetchLinkedWorkspace: h.workspace,
  fetchLinkedFilms: h.films,
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: h.status, generation: h.generation }),
  useAuthGate: () => ({ requireAuth: vi.fn() }),
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/lib/navigation", () => ({ toHref: (p: string) => p }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
let host: HTMLDivElement, root: Root;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const render = () => act(async () => root.render(<CrewLinkedResources crewId="crew" />));
const click = (name: string) =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === name)!.click()
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.status = "authenticated";
  h.generation = 1;
  h.active = true;
  h.ips.mockResolvedValue([{ id: "ip" }]);
  h.workspace.mockResolvedValue({ id: "ws", name: "Studio" });
  h.films.mockResolvedValue({ items: [{ id: "film", title: "Film" }], nextCursor: null });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("loads only when expanded and stops after collapse", async () => {
  await render();
  expect(h.ips).not.toHaveBeenCalled();
  await click("crewLinks.title");
  expect(host.textContent).toContain("Film");
  const signal = h.films.mock.calls[0]![4];
  await click("crewLinks.title");
  expect(signal.aborted).toBe(true);
});
it("guests read linked IPs without private workspace requests", async () => {
  h.status = "anonymous";
  await render();
  await click("crewLinks.title");
  expect(h.ips).toHaveBeenCalledTimes(1);
  expect(h.workspace).not.toHaveBeenCalled();
  expect(h.films).not.toHaveBeenCalled();
  expect(host.textContent).toContain("crewLinks.filmsSignIn");
  expect(host.textContent).not.toContain("crewLinks.none");
});
it("explains multiple IP links without claiming no films are linked", async () => {
  h.ips.mockResolvedValue([{ id: "a" }, { id: "b" }]);
  await render();
  await click("crewLinks.title");
  expect(h.films).not.toHaveBeenCalled();
  expect(host.textContent).toContain("crewLinks.filmsMultipleIps");
  expect(host.textContent).not.toContain("crewLinks.none");
});
it("clears resources and aborts pending reads when backgrounded", async () => {
  await render();
  await click("crewLinks.title");
  const signal = h.ips.mock.calls[0]![2];
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  expect(host.textContent).not.toContain("Film");
});
it("keeps public IPs usable when workspace access fails", async () => {
  h.workspace.mockRejectedValue(new Error("Access denied"));
  await render();
  await click("crewLinks.title");
  expect(host.textContent).toContain("crewLinks.openIp");
  expect(host.textContent).toContain("Access denied");
  expect(h.films).not.toHaveBeenCalled();
});

it("keeps loaded films usable while another page fails and retries the same page", async () => {
  let rejectPage!: (error: Error) => void;
  h.films
    .mockResolvedValueOnce({ items: [{ id: "first", title: "First film" }], nextCursor: "page2" })
    .mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectPage = reject;
      })
    )
    .mockResolvedValueOnce({ items: [{ id: "last", title: "Last film" }], nextCursor: null });
  await render();
  await click("crewLinks.title");
  await click("crewLinks.more");
  expect(host.textContent).toContain("First film");
  expect(host.textContent).toContain("loading");
  await click("First film");
  expect(h.push).toHaveBeenCalledWith("/agent/first");
  await act(async () => rejectPage(new Error("Film page offline")));
  expect(host.textContent).toContain("First film");
  expect(host.textContent).toContain("Film page offline");
  await click("common.retry");
  expect(h.films.mock.calls.map((args) => args[2])).toEqual([null, "page2", "page2"]);
  expect(host.textContent).toContain("First film");
  expect(host.textContent).toContain("Last film");
  await click("Last film");
  expect(h.push).toHaveBeenLastCalledWith("/agent/last");
});
it.each([401, 403, 404])("clears loaded films after access is lost (%s)", async (status) => {
  h.films
    .mockResolvedValueOnce({ items: [{ id: "first", title: "First film" }], nextCursor: "page2" })
    .mockRejectedValueOnce(new ApiRequestError("UNAVAILABLE", "Access unavailable", status))
    .mockResolvedValueOnce({
      items: [{ id: "recovered", title: "Recovered film" }],
      nextCursor: null,
    });
  await render();
  await click("crewLinks.title");
  await click("crewLinks.more");
  expect(host.textContent).not.toContain("First film");
  expect(host.textContent).toContain("Access unavailable");
});
it("does not restore a late film page after the section closes", async () => {
  let finish!: (data: unknown) => void;
  h.films
    .mockResolvedValueOnce({ items: [{ id: "first", title: "First film" }], nextCursor: "page2" })
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
  await render();
  await click("crewLinks.title");
  await click("crewLinks.more");
  const signal = h.films.mock.calls[1][4];
  await click("crewLinks.title");
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ items: [{ id: "late", title: "Late film" }], nextCursor: null }));
  expect(host.textContent).not.toContain("Late film");
});

it.each(["ips", "workspace"] as const)(
  "does not show empty films while %s is loading",
  async (kind) => {
    let finish!: (data: any) => void;
    h[kind].mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    await render();
    await click("crewLinks.title");
    expect(host.textContent).toContain("loading");
    expect(host.textContent).not.toContain("crewLinks.none");
    expect(h.films).not.toHaveBeenCalled();
    await act(async () => finish(kind === "ips" ? [{ id: "ip" }] : { id: "ws", name: "Studio" }));
    expect(host.textContent).toContain("Film");
  }
);
it.each(["ips", "workspace"] as const)(
  "explains unavailable films after %s fails, and refresh recovers",
  async (kind) => {
    h[kind].mockRejectedValueOnce(new Error("Access temporarily unavailable"));
    await render();
    await click("crewLinks.title");
    expect(host.textContent).toContain("Access temporarily unavailable");
    expect(host.textContent).toContain("crewLinks.filmsUnavailable");
    expect(host.textContent).not.toContain("crewLinks.none");
    expect(h.films).not.toHaveBeenCalled();
    await click("thread.refresh");
    expect(host.textContent).toContain("Film");
    expect(host.textContent).not.toContain("crewLinks.filmsUnavailable");
  }
);
it("shows not linked only after the film list is confirmed empty", async () => {
  h.films.mockResolvedValueOnce({ items: [], nextCursor: null });
  await render();
  await click("crewLinks.title");
  expect(host.textContent?.match(/crewLinks.none/g)).toHaveLength(1);
  expect(host.textContent).not.toContain("crewLinks.filmsUnavailable");
});
