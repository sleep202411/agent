import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { usePersonalBalances } from "./use-personal-balances";
const h = vi.hoisted(() => ({
  community: vi.fn(),
  compute: vi.fn(),
  focused: true,
  foreground: true,
}));
vi.mock("@/hooks/use-app-active", () => ({
  useScreenActive: () => h.focused && h.foreground,
}));
vi.mock("@/data/ip-api", () => ({ fetchCommunityPointBalance: h.community }));
vi.mock("@/features/paywall/lib/compute-wallet", () => ({ fetchComputeWalletBalance: h.compute }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
function Probe({ owner }: { owner?: string }) {
  const balances = usePersonalBalances(owner);
  return (
    <div>
      {balances?.community ?? "unknown"}/{balances?.compute ?? "unknown"}
    </div>
  );
}
const render = (owner?: string) => act(async () => root.render(<Probe owner={owner} />));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  h.focused = true;
  h.foreground = true;
  h.community.mockResolvedValue("10");
  h.compute.mockResolvedValue("20");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("loads both balances once on focus and does not fetch for guests", async () => {
  await render();
  expect(h.community).not.toHaveBeenCalled();
  await render("alice:1");
  expect(host.textContent).toBe("10/20");
  await render("alice:1");
  expect(h.community).toHaveBeenCalledTimes(1);
});
it("hides old balances while an authenticated account switch is loading", async () => {
  await render("alice:1");
  const next = deferred<string>();
  h.community.mockReturnValueOnce(next.promise);
  await render("bob:2");
  expect(host.textContent).toBe("unknown/unknown");
  await act(async () => next.resolve("99"));
  expect(host.textContent).toBe("99/20");
});
it("ignores old responses even if the same user signs in again", async () => {
  const old = deferred<string>();
  h.community.mockReturnValueOnce(old.promise);
  await render("alice:1");
  const signal = h.compute.mock.calls[0][0] as AbortSignal;
  await render("alice:3");
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve("999"));
  expect(host.textContent).toBe("10/20");
});
it("hides balances on logout and ignores requests completed after blur", async () => {
  const old = deferred<string>();
  h.community.mockReturnValueOnce(old.promise);
  await render("alice:1");
  h.focused = false;
  await render("alice:1");
  await act(async () => old.resolve("999"));
  expect(host.textContent).toBe("unknown/unknown");
  h.focused = true;
  await render("alice:1");
  expect(host.textContent).toBe("10/20");
  await render();
  expect(host.textContent).toBe("unknown/unknown");
});
it("refreshes on return and isolates a failed balance request", async () => {
  await render("alice:1");
  h.focused = false;
  await render("alice:1");
  h.community.mockRejectedValueOnce(new Error("offline"));
  h.compute.mockResolvedValueOnce("88");
  h.focused = true;
  await render("alice:1");
  expect(host.textContent).toBe("unknown/88");
});

it.each(["focused", "foreground"] as const)(
  "clears stale balances and aborts both reads across %s changes",
  async (state) => {
    await render("alice:1");
    expect(host.textContent).toBe("10/20");
    const signal = h.community.mock.calls[0][0] as AbortSignal;
    expect(h.compute.mock.calls[0][0]).toBe(signal);
    h[state] = false;
    await render("alice:1");
    expect(signal.aborted).toBe(true);
    expect(host.textContent).toBe("unknown/unknown");
    const next = deferred<string>();
    h.community.mockReturnValueOnce(next.promise);
    h.compute.mockResolvedValueOnce("88");
    h[state] = true;
    await render("alice:1");
    expect(host.textContent).toBe("unknown/unknown");
    expect(h.community).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve("15"));
    expect(host.textContent).toBe("15/88");
  }
);
