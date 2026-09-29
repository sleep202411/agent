import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PositionCreate } from "./position-create";
vi.mock("@/config/app-env", () => ({ isChinaRegion: false }));
vi.mock("./task-picker", () => ({
  TaskPicker: ({
    recruitmentOnly,
    onSelect,
  }: {
    recruitmentOnly: boolean;
    onSelect: (v: object) => void;
  }) => (
    <button
      onClick={() =>
        onSelect({ id: "00000000-0000-4000-8000-000000000001", number: 1, title: "Shot" })
      }
    >
      Pick {String(recruitmentOnly)}
    </button>
  ),
}));
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), post: vi.fn(), close: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white", border: "gray" }) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <textarea
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));
vi.mock("./crew-finance-api", () => ({
  formatFinanceMoney: (amount: string, currency: string) => `${currency} ${amount}`,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (key: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === key)!;
const click = async (key: string) => {
  await act(async () => button(key).click());
};
const render = async () => {
  await act(async () =>
    root.render(<PositionCreate crewId="crew" userId="manager" generation={1} onClose={h.close} />)
  );
};
const type = async (key: string, value: string) => {
  await act(async () => {
    const input = host.querySelector(`textarea[aria-label="${key}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      value
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const receipt = (data: import("./position-create-api").NewPosition) => ({
  ...data,
  id: "position",
  crewId: "crew",
  taskId: data.taskId ?? null,
  status: "open",
  recruitedCount: 0,
  salary: {
    period: data.salary.period,
    currency: data.salary.currency,
    minAmount:
      data.salary.min === null
        ? null
        : Math.round(data.salary.min * (data.salary.currency === "JPY" ? 1 : 100)),
    maxAmount:
      data.salary.max === null
        ? null
        : Math.round(data.salary.max * (data.salary.currency === "JPY" ? 1 : 100)),
    negotiable: data.salary.negotiable,
  },
});
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue({
    userId: "manager",
    permissions: ["openings.manage", "tasks.manage", "tasks.view"],
  });
  h.post.mockImplementation(async (_path, options) => receipt(options.data));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("requires the description before publishing", async () => {
  await render();
  await click("positionCreate.publish");
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("positionCreate.invalid");
});
it("publishes role, skills and salary in display units", async () => {
  await render();
  await type("positionCreate.description", "Direct the film");
  await type("positionCreate.skills", "Editing, Lighting");
  await type("positionCreate.min", "12.34");
  await type("positionCreate.max", "50");
  await click("positionCreate.publish");
  expect(h.post).toHaveBeenCalledWith(
    "/crews/crew/positions",
    expect.objectContaining({
      data: expect.objectContaining({
        positionType: "director",
        requiredSkills: ["Editing", "Lighting"],
        salary: { period: "project", currency: "USD", min: 12.34, max: 50, negotiable: false },
      }),
    })
  );
  expect(host.textContent).toContain("positionCreate.saved");
  expect(button("positionCreate.publish")).toBeUndefined();
});
it("requests only recruitable tasks and permits private task recruitment", async () => {
  await render();
  await type("positionCreate.description", "Direct a shot");
  await click("positionCreate.task");
  await click("Pick true");
  await click("positionCreate.visibility · positionCreate.public");
  await click("positionCreate.private");
  await click("positionCreate.publish");
  expect(h.post).toHaveBeenCalledWith(
    "/crews/crew/positions",
    expect.objectContaining({
      data: expect.objectContaining({
        taskId: "00000000-0000-4000-8000-000000000001",
        recruitmentVisibility: "private",
      }),
    })
  );
});
it("clearing the task returns visibility to public", async () => {
  await render();
  await type("positionCreate.description", "Direct a shot");
  await click("positionCreate.task");
  await click("Pick true");
  await click("positionCreate.visibility · positionCreate.public");
  await click("positionCreate.private");
  await click("positionCreate.clearTask");
  await click("positionCreate.publish");
  expect(h.post.mock.calls[0]![1].data.recruitmentVisibility).toBe("public");
  expect(h.post.mock.calls[0]![1].data.taskId).toBeUndefined();
});
it("does not expose task linking without both task permissions", async () => {
  h.get.mockResolvedValue({ userId: "manager", permissions: ["openings.manage"] });
  await render();
  expect(button("positionCreate.task")).toBeUndefined();
});
it("blocks the form when management access is absent", async () => {
  h.get.mockResolvedValue({ userId: "manager", permissions: [] });
  await render();
  expect(host.querySelector("textarea")).toBeNull();
  expect(h.post).not.toHaveBeenCalled();
});
it("requires checking the list instead of retrying an uncertain create", async () => {
  h.post.mockRejectedValue(new Error("Network"));
  await render();
  await type("positionCreate.description", "Film");
  await click("positionCreate.publish");
  expect(host.textContent).toContain("positionCreate.recheck");
  expect(button("positionCreate.publish")).toBeUndefined();
  expect(h.post).toHaveBeenCalledTimes(1);
  await click("nativeApplications.back");
  expect(h.close).toHaveBeenCalledTimes(1);
});
it("locks duplicate publish taps and back navigation", async () => {
  let resolve!: (v: unknown) => void;
  h.post.mockReturnValue(new Promise((r) => (resolve = r)));
  await render();
  await type("positionCreate.description", "Film");
  await act(async () => {
    button("positionCreate.publish").click();
    button("positionCreate.publish").click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(button("nativeApplications.back").disabled).toBe(true);
  await act(async () => resolve(receipt(h.post.mock.calls[0]![1].data)));
});
it("does not write after account changes", async () => {
  await render();
  await type("positionCreate.description", "Film");
  h.generation = 2;
  await click("positionCreate.publish");
  expect(h.post).not.toHaveBeenCalled();
});
it("ignores late success after leaving", async () => {
  let resolve!: (v: unknown) => void;
  h.post.mockReturnValue(new Promise((r) => (resolve = r)));
  await render();
  await type("positionCreate.description", "Film");
  await click("positionCreate.publish");
  await act(async () => root.render(null));
  await act(async () => resolve(receipt(h.post.mock.calls[0]![1].data)));
  expect(host.textContent).toBe("");
});
