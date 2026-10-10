import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewActionsMenu } from "./crew-actions-menu";
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
const native = vi.hoisted(() => ({
  platform: { OS: "android", select: (options: any) => options.default },
  dismiss: undefined as (() => void) | undefined,
}));
vi.mock("react-native", () => ({
  Platform: native.platform,
  Modal: ({ visible, children, onDismiss }: any) => {
    native.dismiss = onDismiss;
    return visible ? <div>{children}</div> : null;
  },
  View: ({ children }: any) => <div>{children}</div>,
  ScrollView: ({ children }: any) => <div>{children}</div>,
  Pressable: ({ children, onPress, disabled, accessibilityRole }: any) =>
    accessibilityRole === "button" ? (
      <button onClick={onPress} disabled={disabled}>
        {children}
      </button>
    ) : (
      <div>{children}</div>
    ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const select = vi.fn(),
  close = vi.fn();
const render = (visible = true, busy = false) =>
  act(async () =>
    root.render(<CrewActionsMenu visible={visible} busy={busy} onSelect={select} onClose={close} />)
  );
const click = (label: string) =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click()
  );
beforeEach(() => {
  vi.clearAllMocks();
  native.platform.OS = "android";
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it.each([
  ["crewTasks.title", "tasks"],
  ["crewDetail.applicationsAction", "applications"],
  ["applicationReview.title", "reviews"],
  ["inviteManagement.title", "invitations"],
  ["crewAgreements.title", "agreements"],
  ["crewFinance.title", "finance"],
  ["report.reportAction", "report"],
  ["crewDetail.blockAction", "block"],
])("makes %s directly selectable in one menu", async (label, action) => {
  await render();
  await click(label);
  expect(select).toHaveBeenCalledExactlyOnceWith(action);
});
it("cancels without selecting and removes hidden actions", async () => {
  await render();
  await click("report.cancel");
  expect(close).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
  await render(false);
  expect(host.querySelector("button")).toBeNull();
});
it("disables duplicate moderation while keeping navigation and cancellation usable", async () => {
  await render(true, true);
  await click("report.reportAction");
  await click("crewDetail.blockAction");
  expect(select).not.toHaveBeenCalled();
  await click("crewTasks.title");
  expect(select).toHaveBeenCalledExactlyOnceWith("tasks");
  await click("report.cancel");
  expect(close).toHaveBeenCalledOnce();
});

it("waits for native iOS dismissal before opening the next action", async () => {
  native.platform.OS = "ios";
  await render();
  await click("report.reportAction");
  await click("crewDetail.blockAction");
  expect(close).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
  await render(false);
  await act(async () => native.dismiss?.());
  expect(select).toHaveBeenCalledExactlyOnceWith("report");
  await act(async () => native.dismiss?.());
  expect(select).toHaveBeenCalledTimes(1);
});
