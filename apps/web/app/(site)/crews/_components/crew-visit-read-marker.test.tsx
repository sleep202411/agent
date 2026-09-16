// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewVisitReadMarker } from "./crew-visit-read-marker";
const state = vi.hoisted(() => ({ userId: "alice", post: vi.fn(), error: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: state.userId } }) }));
vi.mock("../_hooks/api", () => ({ crewApi: { post: state.post } }));
vi.mock("sonner", () => ({ toast: { error: state.error } }));
let root: Root;
let client: QueryClient;
async function render(crewId: string) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <CrewVisitReadMarker crewId={crewId} />
      </QueryClientProvider>
    )
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  state.userId = "alice";
  state.post.mockReset().mockResolvedValue({ count: 2 });
  state.error.mockReset();
  root = createRoot(document.createElement("div"));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["notifications", "crew-unread", "alice"], [{ crewId: "one", count: 2 }]);
  client.setQueryData(["notifications", "crew-unread", "bob"], [{ crewId: "one", count: 3 }]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.restoreAllMocks();
});
it("marks the visited Crew and invalidates only its account's notification caches", async () => {
  await render("crew/one");
  expect(state.post).toHaveBeenCalledWith(
    "/notifications/crews/crew%2Fone/read",
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
  expect(client.getQueryState(["notifications", "crew-unread", "alice"])?.isInvalidated).toBe(true);
  expect(client.getQueryState(["notifications", "crew-unread", "bob"])?.isInvalidated).toBe(false);
});
it("waits for a hidden page to become visible", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await render("one");
  expect(state.post).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(state.post).toHaveBeenCalledTimes(1);
});
it("aborts abandoned visits and ignores their delayed completion", async () => {
  let finish!: (value: unknown) => void;
  state.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render("one");
  const signal = state.post.mock.calls[0][1].signal;
  state.userId = "bob";
  await render("two");
  expect(signal.aborted).toBe(true);
  await act(async () => {
    finish({ count: 2 });
  });
  expect(client.getQueryState(["notifications", "crew-unread", "alice"])?.isInvalidated).toBe(
    false
  );
});
it("preserves counts on failure and retries on a later visible visit", async () => {
  state.post.mockRejectedValueOnce(new Error("Read unavailable"));
  await render("one");
  expect(state.error).toHaveBeenCalledWith("Read unavailable");
  expect(client.getQueryState(["notifications", "crew-unread", "alice"])?.isInvalidated).toBe(
    false
  );
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(state.post).toHaveBeenCalledTimes(2);
});
