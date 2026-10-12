import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useMyCrews } from "./use-my-crews";
const h = vi.hoisted(() => ({ load: vi.fn(), active: true, version: 0, t: (key: string) => key }));
vi.mock("@/data/crew-api", () => ({ fetchMyCrews: h.load }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/data/browse-refresh", () => ({ useBrowseVersion: () => h.version }));
vi.mock("@/i18n", () => ({ useTranslations: () => h.t }));
let host: HTMLDivElement, root: Root;
function Probe({ owner }: { owner?: string }) {
  const state = useMyCrews(owner);
  return (
    <div>
      {state.items?.map((item) => (
        <span key={item.id}>{item.name}</span>
      ))}
      {state.error}
      {state.loading ? "loading" : null}
      <button onClick={state.refresh}>retry</button>
    </div>
  );
}
const render = (owner?: string) => act(async () => root.render(<Probe owner={owner} />));
beforeEach(() => {
  h.load.mockReset();
  h.active = true;
  h.version = 0;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(async () => root.unmount()));
it("does not request guest collections and retries explicit upstream errors", async () => {
  await render();
  expect(h.load).not.toHaveBeenCalled();
  h.load
    .mockRejectedValueOnce(new Error("Membership unavailable"))
    .mockResolvedValueOnce([{ id: "a", name: "My Crew" }]);
  await render("alice");
  expect(host.textContent).toContain("Membership unavailable");
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("My Crew");
  expect(host.textContent).not.toContain("Membership unavailable");
});
it("hides old membership on background and reloads it on return", async () => {
  h.load
    .mockResolvedValueOnce([{ id: "a", name: "Former Crew" }])
    .mockResolvedValueOnce([{ id: "b", name: "Joined Crew" }]);
  await render("alice");
  const firstSignal = h.load.mock.calls[0][0];
  h.active = false;
  await render("alice");
  expect(firstSignal.aborted).toBe(true);
  expect(host.textContent).not.toContain("Former Crew");
  h.active = true;
  await render("alice");
  expect(host.textContent).toContain("Joined Crew");
  expect(h.load).toHaveBeenCalledTimes(2);
});
it("discards late previous-account results even if transport ignores cancellation", async () => {
  let finish!: (data: unknown) => void;
  h.load
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValueOnce([{ id: "b", name: "Bob Crew" }]);
  await render("alice");
  await render("bob");
  await act(async () => finish([{ id: "a", name: "Alice Crew" }]));
  expect(host.textContent).toContain("Bob Crew");
  expect(host.textContent).not.toContain("Alice Crew");
});
it("refetches after a browse mutation rather than restoring a stale cached list", async () => {
  h.load.mockResolvedValueOnce([{ id: "a", name: "Old Crew" }]).mockResolvedValueOnce([]);
  await render("alice");
  h.version++;
  await render("alice");
  expect(host.textContent).not.toContain("Old Crew");
  expect(h.load).toHaveBeenCalledTimes(2);
});
