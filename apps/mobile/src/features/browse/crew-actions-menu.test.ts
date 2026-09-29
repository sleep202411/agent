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
