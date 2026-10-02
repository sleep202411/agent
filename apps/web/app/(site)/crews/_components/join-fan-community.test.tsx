import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JoinFanCommunity } from "./join-fan-community";
import { crewApi } from "../_hooks/api";
const state = vi.hoisted(() => ({
  ip: "ip" as string | null,
  id: "alice" as string | null,
  push: vi.fn(),
  open: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.id ? { id: state.id } : null }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: state.open }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("../_hooks/use-crew-linked-ips", () => ({
  useCrewLinkedIps: () => ({ data: state.ip ? [{ id: state.ip }] : [], isError: false }),
}));
vi.mock("../_hooks/api", () => ({ crewApi: { put: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  state.id = "alice";
  state.ip = "ip";
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.resetAllMocks();
});
const render = () => act(() => root.render(<JoinFanCommunity crewId="crew" />));
it("requires sign-in before joining", () => {
  state.id = null;
  render();
  act(() => container.querySelector("button")!.click());
  expect(state.open).toHaveBeenCalled();
  expect(crewApi.put).not.toHaveBeenCalled();
});
it("prevents duplicate requests and suppresses navigation after an account change", async () => {
  let finish!: (value: { conversationId: string }) => void;
  let signal: AbortSignal | undefined;
  vi.mocked(crewApi.put).mockImplementation((_url, options) => {
    signal = options?.signal as AbortSignal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  render();
  act(() => {
    container.querySelector("button")!.click();
    container.querySelector("button")!.click();
  });
  expect(crewApi.put).toHaveBeenCalledTimes(1);
  state.id = "bob";
  render();
  expect(signal?.aborted).toBe(true);
  await act(async () => finish({ conversationId: "old-room" }));
  expect(state.push).not.toHaveBeenCalled();
  expect(container.querySelector("button")?.disabled).toBe(false);
});
it("retains a specific failure and allows retry into the community room", async () => {
  vi.mocked(crewApi.put)
    .mockRejectedValueOnce(new Error("Crew not found"))
    .mockResolvedValueOnce({ code: 200, data: { conversationId: "fan-room" } });
  render();
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Crew not found");
  await act(async () => container.querySelector("button")!.click());
  expect(state.push).toHaveBeenCalledWith("/en-US/messages/fan-room");
});

it("hides Follow when no IP is linked", () => {
  state.ip = null;
  render();
  expect(container.querySelector("button")).toBeNull();
});
