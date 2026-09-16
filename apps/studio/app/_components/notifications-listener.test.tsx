// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { NotificationDTO } from "@repo/shared/notifications";
import { NotificationsListener } from "./notifications-listener";

const state = vi.hoisted(() => ({
  user: "alice",
  post: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
  close: vi.fn(),
  invalidateQueries: vi.fn(),
  open: vi.fn(),
}));
const router = { push: state.push };
const client = { invalidateQueries: state.invalidateQueries };
const translate = (key: string) => key;
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next-intl", () => ({ useLocale: () => "en-US", useTranslations: () => translate }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => client }));
vi.mock("./auth-provider", () => ({ useAuth: () => ({ user: { id: state.user } }) }));
vi.mock("./region-provider", () => ({ useSiteRegion: () => "com" }));
vi.mock("./workspace-context", () => ({ WORKSPACES_QUERY_KEY: ["workspaces"] }));
vi.mock("@/lib/api", () => ({ api: { post: state.post } }));
vi.mock("@/lib/notifications/realtime", () => ({ openNotificationsRealtime: state.open }));
vi.mock("@/lib/notifications/deeplink", () => ({ notificationHref: () => "/en-US/project/test" }));
vi.mock("sonner", () => ({
  toast: Object.assign(state.toast, {
    warning: state.toast,
    error: state.error,
    dismiss: state.dismiss,
  }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
async function mount() {
  state.open.mockReturnValue({ close: state.close });
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<NotificationsListener />));
}
function notify() {
  const handlers = state.open.mock.calls.at(-1)![1] as {
    onNotification: (n: NotificationDTO) => void;
    onReady: () => void;
  };
  handlers.onNotification({
    id: "n1",
    type: "story-project.member.added",
    title: "Shared",
    body: "Private description",
    readAt: null,
  } as NotificationDTO);
  return { handlers, action: state.toast.mock.calls.at(-1)![1].action.onClick as () => void };
}
afterEach(() => {
  act(() => root?.unmount());
  vi.resetAllMocks();
  state.user = "alice";
});
it("dismisses account-owned toasts and rejects retained actions and events", async () => {
  await mount();
  const old = notify();
  state.user = "bob";
  await act(async () => root.render(<NotificationsListener />));
  expect(state.dismiss).toHaveBeenCalledWith("notification:alice:n1");
  state.toast.mockClear();
  state.invalidateQueries.mockClear();
  old.action();
  old.handlers.onReady();
  old.handlers.onNotification({
    id: "late",
    type: "story-project.member.added",
  } as NotificationDTO);
  expect(state.post).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
  expect(state.toast).not.toHaveBeenCalled();
  expect(state.invalidateQueries).not.toHaveBeenCalled();
});
it("aborts abandoned mark-read and suppresses its late failure while preserving active retry errors", async () => {
  let reject!: (error: Error) => void;
  state.post.mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      })
  );
  await mount();
  notify().action();
  const signal = state.post.mock.calls[0]![1].signal as AbortSignal;
  expect(state.push).toHaveBeenCalledTimes(1);
  state.user = "bob";
  await act(async () => root.render(<NotificationsListener />));
  expect(signal.aborted).toBe(true);
  await act(async () => reject(new Error("old failure")));
  expect(state.error).not.toHaveBeenCalled();
  state.post.mockRejectedValue(new Error("current failure"));
  await act(async () => notify().action());
  expect(state.error).toHaveBeenCalledWith("current failure");
});
