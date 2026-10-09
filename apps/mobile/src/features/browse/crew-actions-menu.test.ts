import { beforeEach, expect, it, vi } from "vitest";
import { showCrewActionsMenu } from "./crew-actions-menu";
const h = vi.hoisted(() => ({
  platform: { OS: "ios" },
  sheet: vi.fn(),
  alert: vi.fn(),
  safety: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: h.platform,
  Alert: { alert: h.alert },
  ActionSheetIOS: { showActionSheetWithOptions: h.sheet },
}));
vi.mock("@/components/report-actions", () => ({ showContentActionsMenu: h.safety }));
const options = {
  t: (key: string) => key,
  onApplications: vi.fn(),
  onReport: vi.fn(),
  onBlock: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  h.platform.OS = "ios";
});
it("offers applications alongside existing iOS report/block actions with correct destructive index", () => {
  showCrewActionsMenu(options);
  const [configuration, select] = h.sheet.mock.calls[0];
  expect(configuration).toEqual({
    options: [
      "report.cancel",
      "crewDetail.applicationsAction",
      "report.reportAction",
      "crewDetail.blockAction",
    ],
    cancelButtonIndex: 0,
    destructiveButtonIndex: 3,
  });
  select(0);
  expect(options.onApplications).not.toHaveBeenCalled();
  expect(options.onReport).not.toHaveBeenCalled();
  expect(options.onBlock).not.toHaveBeenCalled();
  select(1);
  select(2);
  select(3);
  expect(options.onApplications).toHaveBeenCalledTimes(1);
  expect(options.onReport).toHaveBeenCalledTimes(1);
  expect(options.onBlock).toHaveBeenCalledTimes(1);
});
it("retains all Android actions within the native three-button limit", () => {
  h.platform.OS = "android";
  showCrewActionsMenu(options);
  expect(h.sheet).not.toHaveBeenCalled();
  const buttons = h.alert.mock.calls[0][2];
  expect(buttons).toHaveLength(3);
  expect(buttons[2]).toEqual({ text: "report.cancel", style: "cancel" });
  buttons[0].onPress();
  expect(options.onApplications).toHaveBeenCalledTimes(1);
  buttons[1].onPress();
  expect(h.safety).toHaveBeenCalledWith({
    t: options.t,
    blockLabel: "crewDetail.blockAction",
    onReport: options.onReport,
    onBlock: options.onBlock,
  });
});

it("opens native tasks from iOS and Android without losing existing actions", () => {
  const onTasks = vi.fn();
  showCrewActionsMenu({ ...options, onTasks });
  const [config, select] = h.sheet.mock.calls[0];
  expect(config.options[4]).toBe("crewTasks.title");
  expect(config.destructiveButtonIndex).toBe(3);
  select(4);
  expect(onTasks).toHaveBeenCalledOnce();
  h.platform.OS = "android";
  showCrewActionsMenu({ ...options, onTasks });
  const buttons = h.alert.mock.calls[0][2];
  expect(buttons).toHaveLength(3);
  buttons[0].onPress();
  expect(onTasks).toHaveBeenCalledTimes(2);
  buttons[1].onPress();
  expect(h.alert.mock.calls[1][2][0].text).toBe("crewDetail.applicationsAction");
});

it("opens Finance on iOS and Android while preserving all existing actions", () => {
  const onFinance = vi.fn(),
    onTasks = vi.fn();
  showCrewActionsMenu({ ...options, onTasks, onFinance });
  const [config, select] = h.sheet.mock.calls[0];
  expect(config.options[5]).toBe("crewFinance.title");
  select(5);
  expect(onFinance).toHaveBeenCalledOnce();
  h.platform.OS = "android";
  showCrewActionsMenu({ ...options, onTasks, onFinance });
  const buttons = h.alert.mock.calls[0][2];
  expect(buttons).toHaveLength(3);
  buttons[0].onPress();
  expect(onFinance).toHaveBeenCalledTimes(2);
  buttons[1].onPress();
  expect(h.alert.mock.calls[1][2][0].text).toBe("crewTasks.title");
});

it.each([false, true])("adds iOS Agreements with correct optional indices (tasks=%s)", (tasks) => {
  const onAgreements = vi.fn(),
    onTasks = tasks ? vi.fn() : undefined;
  showCrewActionsMenu({ ...options, onTasks, onAgreements });
  const [config, select] = h.sheet.mock.calls[0];
  const index = config.options.indexOf("crewAgreements.title");
  expect(index).toBe(tasks ? 5 : 4);
  select(index);
  expect(onAgreements).toHaveBeenCalledOnce();
  if (onTasks) expect(onTasks).not.toHaveBeenCalled();
});
it("keeps Android agreements, tasks, applications and safety reachable with three buttons", () => {
  h.platform.OS = "android";
  const onAgreements = vi.fn(),
    onFinance = vi.fn(),
    onTasks = vi.fn();
  showCrewActionsMenu({ ...options, onAgreements, onFinance, onTasks });
  h.alert.mock.calls[0][2][1].onPress();
  expect(h.alert.mock.calls[1][2][0].text).toBe("crewAgreements.title");
  h.alert.mock.calls[1][2][0].onPress();
  expect(onAgreements).toHaveBeenCalledOnce();
  h.alert.mock.calls[1][2][1].onPress();
  expect(h.alert.mock.calls[2][2][0].text).toBe("crewTasks.title");
  h.alert.mock.calls[2][2][1].onPress();
  expect(h.alert.mock.calls[3][2][0].text).toBe("crewDetail.applicationsAction");
  h.alert.mock.calls[3][2][1].onPress();
  expect(h.safety).toHaveBeenCalledOnce();
  for (const call of h.alert.mock.calls) expect(call[2]).toHaveLength(3);
});
it.each([0, 1, 2, 3, 4, 5, 6, 7])(
  "routes invitation management with optional iOS actions (%s)",
  (mask) => {
    const onInvitations = vi.fn();
    showCrewActionsMenu({
      ...options,
      onInvitations,
      onTasks: mask & 1 ? vi.fn() : undefined,
      onFinance: mask & 2 ? vi.fn() : undefined,
      onAgreements: mask & 4 ? vi.fn() : undefined,
    });
    const [config, select] = h.sheet.mock.calls[0];
    select(config.options.indexOf("inviteManagement.title"));
    expect(onInvitations).toHaveBeenCalledOnce();
    expect(config.destructiveButtonIndex).toBe(3);
  }
);
it("preserves Android finance and safety after invitations", () => {
  h.platform.OS = "android";
  const onInvitations = vi.fn();
  showCrewActionsMenu({ ...options, onInvitations, onFinance: vi.fn() });
  h.alert.mock.calls[0][2][0].onPress();
  expect(onInvitations).toHaveBeenCalledOnce();
  h.alert.mock.calls[0][2][1].onPress();
  expect(h.alert.mock.calls[1][2][0].text).toBe("crewFinance.title");
  h.alert.mock.calls[1][2][1].onPress();
  h.alert.mock.calls[2][2][1].onPress();
  expect(h.safety).toHaveBeenCalledOnce();
});
it.each([false, true])("opens reviewer inbox with optional prior actions (%s)", (full) => {
  const onReviews = vi.fn();
  showCrewActionsMenu({
    ...options,
    onReviews,
    ...(full
      ? { onTasks: vi.fn(), onFinance: vi.fn(), onAgreements: vi.fn(), onInvitations: vi.fn() }
      : {}),
  });
  const [config, select] = h.sheet.mock.calls[0];
  select(config.options.indexOf("applicationReview.title"));
  expect(onReviews).toHaveBeenCalledOnce();
});
it("keeps Android reviewer and invitation actions reachable", () => {
  h.platform.OS = "android";
  const onReviews = vi.fn(),
    onInvitations = vi.fn();
  showCrewActionsMenu({ ...options, onReviews, onInvitations });
  h.alert.mock.calls[0][2][0].onPress();
  expect(onReviews).toHaveBeenCalledOnce();
  h.alert.mock.calls[0][2][1].onPress();
  h.alert.mock.calls[1][2][0].onPress();
  expect(onInvitations).toHaveBeenCalledOnce();
});
