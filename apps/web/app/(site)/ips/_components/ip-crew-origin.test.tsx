// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { IpCrewOrigin } from "./ip-crew-origin";
import { api } from "@/src/lib/api";
const state = vi.hoisted(() => ({ id: "owner" as string | null, push: vi.fn(), open: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.id ? { id: state.id } : null }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: state.open }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@/src/lib/api", () => ({ api: { get: vi.fn(), put: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const crew = { id: "crew", name: "Origin Crew" };
beforeEach(() => {
  state.id = "owner";
  container = document.createElement("div");
  root = createRoot(container);
  vi.mocked(api.get).mockResolvedValue({ crew });
});
afterEach(() => {
  act(() => root.unmount());
  vi.resetAllMocks();
});
const render = (editable = false) =>
  act(async () => root.render(<IpCrewOrigin ipId="ip" editable={editable} />));
const click = (label: string) =>
  Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent === label)!
    .click();
it("opens the returned fan conversation using the IP like route", async () => {
  await render();
  vi.mocked(api.put).mockResolvedValue({ conversationId: "fans" });
  await act(async () => click("join"));
  expect(api.put).toHaveBeenCalledWith(
    "/aurora/ip-commerce/ips/ip/like",
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
  expect(state.push).toHaveBeenCalledWith("/en-US/messages/fans");
});
it("prevents duplicate joins and cancels navigation after an account change", async () => {
  await render();
  let finish!: (value: { conversationId: string }) => void;
  let signal!: AbortSignal;
  vi.mocked(api.put).mockImplementation((_path, opts) => {
    signal = opts!.signal as AbortSignal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  act(() => {
    click("join");
    click("join");
  });
  expect(api.put).toHaveBeenCalledTimes(1);
  state.id = "replacement";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ conversationId: "old-fans" }));
  expect(state.push).not.toHaveBeenCalled();
});
it("requires sign-in before joining and preserves errors for retry", async () => {
  state.id = null;
  await render();
  act(() => click("join"));
  expect(state.open).toHaveBeenCalled();
  expect(api.put).not.toHaveBeenCalled();
  state.id = "owner";
  await render();
  vi.mocked(api.put).mockRejectedValue(new Error("Crew unavailable"));
  await act(async () => click("join"));
  expect(container.textContent).toContain("Crew unavailable");
  expect(container.querySelector("button")!.disabled).toBe(false);
});
it("uses the loaded IP version and retains the selection on failed save", async () => {
  vi.mocked(api.get).mockResolvedValue({ crewId: "crew", version: 7, choices: [crew] });
  await render(true);
  vi.mocked(api.put).mockRejectedValue(new Error("Refresh first"));
  await act(async () => click("save"));
  expect(api.put).toHaveBeenCalledWith(
    "/aurora/ip-commerce/me/ips/ip/crew",
    expect.objectContaining({ data: { crewId: "crew", expectedVersion: 7 } })
  );
  expect(container.querySelector('[role="combobox"]')!.textContent).toContain("Origin Crew");
  expect(container.textContent).toContain("Refresh first");
});

it("ignores an old IP read after switching to a different IP", async () => {
  let finish!: (value: unknown) => void;
  let signal!: AbortSignal;
  vi.mocked(api.get).mockImplementationOnce((_path, options) => {
    signal = options!.signal as AbortSignal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await render();
  vi.mocked(api.get).mockResolvedValue({ crew: { id: "new", name: "New Crew" } });
  await act(async () => root.render(<IpCrewOrigin ipId="other-ip" />));
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ crew: { id: "old", name: "Old Crew" } }));
  expect(container.textContent).toContain("New Crew");
  expect(container.textContent).not.toContain("Old Crew");
});

it("recovers an initial editable read failure before permitting a versioned save", async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error("Temporarily unavailable"));
  await render(true);
  const save = () =>
    Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "save"
    )!;
  expect(save().disabled).toBe(true);
  vi.mocked(api.get).mockResolvedValue({ crewId: "crew", version: 12, choices: [crew] });
  await act(async () => click("reload"));
  expect(save().disabled).toBe(false);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  vi.mocked(api.put).mockResolvedValue({ crewId: "crew", version: 13, choices: [crew] });
  await act(async () => click("save"));
  expect(api.put).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ data: { crewId: "crew", expectedVersion: 12 } })
  );
});

it("retires an editable save when the host removes edit permission", async () => {
  vi.mocked(api.get).mockResolvedValue({ crewId: "crew", version: 7, choices: [crew] });
  await render(true);
  let finish!: (value: unknown) => void;
  let signal!: AbortSignal;
  vi.mocked(api.put).mockImplementation((_path, options) => {
    signal = options!.signal as AbortSignal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  act(() => click("save"));
  vi.mocked(api.get).mockResolvedValue({ crew: { id: "visible", name: "Public Crew" } });
  await render(false);
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ crewId: "crew", version: 8, choices: [crew] }));
  expect(container.textContent).toContain("Public Crew");
  expect(container.querySelector('[role="combobox"]')).toBeNull();
});
