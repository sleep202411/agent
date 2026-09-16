import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EntityEventsClientHandlers } from "./entity-events-client";
const mock = vi.hoisted(() => ({
  user: null as { id: string } | null,
  dispatch: vi.fn(),
  store: { getState: () => ({ project: { currentProjectId: null } }) },
  clients: [] as { handlers: EntityEventsClientHandlers; close: ReturnType<typeof vi.fn> }[],
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: mock.user }) }));
vi.mock("@/src/store", () => ({
  useAppDispatch: () => mock.dispatch,
  useAppStore: () => mock.store,
}));
vi.mock("@/src/store/slices/assistantSlice", () => ({ refreshProjectDetail: vi.fn() }));
vi.mock("./entity-events-client", () => ({
  openEntityEventsClient: (handlers: EntityEventsClientHandlers) => {
    const client = { handlers, close: vi.fn() };
    mock.clients.push(client);
    return client;
  },
}));
import { useEntityEventsSession } from "./use-entity-events-session";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
function Probe() {
  useEntityEventsSession({ enabled: true });
  return null;
}
function render(id: string | null) {
  mock.user = id === null ? null : { id };
  act(() => root.render(<Probe />));
}
beforeEach(() => {
  mock.clients.length = 0;
  mock.dispatch.mockClear();
  mock.user = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
});
it("waits for an account then opens after login", () => {
  render(null);
  expect(mock.clients).toHaveLength(0);
  render("first");
  expect(mock.clients).toHaveLength(1);
});
it("replaces the session on account change and closes it on logout", () => {
  render("first");
  const first = mock.clients[0]!;
  render("second");
  expect(first.close).toHaveBeenCalledOnce();
  expect(mock.clients).toHaveLength(2);
  render(null);
  expect(mock.clients[1]!.close).toHaveBeenCalledOnce();
});
it("rejects abandoned callbacks and retains current invalidation", () => {
  render("first");
  const first = mock.clients[0]!;
  render("second");
  first.handlers.onEntityChanged?.({ entity: "world" } as Parameters<
    NonNullable<EntityEventsClientHandlers["onEntityChanged"]>
  >[0]);
  expect(mock.dispatch).not.toHaveBeenCalled();
  mock.clients[1]!.handlers.onEntityChanged?.({ entity: "world" } as Parameters<
    NonNullable<EntityEventsClientHandlers["onEntityChanged"]>
  >[0]);
  expect(mock.dispatch).toHaveBeenCalledOnce();
});
it("does not reconnect for a same-account rerender", () => {
  render("same");
  render("same");
  expect(mock.clients).toHaveLength(1);
  expect(mock.clients[0]!.close).not.toHaveBeenCalled();
});
