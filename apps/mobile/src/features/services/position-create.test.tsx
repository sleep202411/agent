import { PositionEdit } from "./position-edit";
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
const h = vi.hoisted(() => ({
  generation: 1,
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post, patch: h.patch } }));
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
    accessibilityLabel,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>
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
  [...host.querySelectorAll("button")].find(
    (b) => b.textContent === key || b.getAttribute("aria-label") === key
  )!;
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
  h.get.mockResolvedValueOnce({ skills: ["Editing", "Lighting"] });
  await click("crewSkills.label · 0/20");
  await click("Editing");
  await click("Lighting");
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

const editing: import("./position-edit-api").EditablePosition = {
  id: "position",
  crewId: "crew",
  taskId: null,
  recruitmentVisibility: "public",
  positionType: "director",
  description: "Existing role",
  targetCount: 3,
  recruitedCount: 1,
  status: "frozen",
  workMode: "remote",
  location: null,
  employmentType: "project_based",
  experienceLevel: "any",
  requiredSkills: ["Editing"],
  salary: {
    currency: "USD",
    period: "project",
    minAmount: 1234,
    maxAmount: 5000,
    negotiable: false,
  },
  durationMonths: 6,
  revenueSharePercent: 2.5,
  closeDate: "2028-02-29",
};
const renderEdit = async () => {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("members/me")
      ? { userId: "manager", permissions: ["openings.manage"] }
      : { items: [editing], nextCursor: null }
  );
  await act(async () =>
    root.render(
      <PositionCreate
        crewId="crew"
        userId="manager"
        generation={1}
        onClose={h.close}
        editing={editing}
      />
    )
  );
};
it("prefills editing values and keeps task and role immutable", async () => {
  await renderEdit();
  expect(
    (host.querySelector('[aria-label="positionCreate.min"]') as HTMLTextAreaElement).value
  ).toBe("12.34");
  expect(
    (host.querySelector('[aria-label="positionCreate.duration"]') as HTMLTextAreaElement).value
  ).toBe("6");
  expect(button("positionCreate.task")).toBeUndefined();
  expect(button("positionCreate.role · crew.positions.director")).toBeUndefined();
  await type("positionCreate.description", "New description");
  h.patch.mockResolvedValue({ ...editing, description: "New description" });
  await click("positionEdit.save");
  expect(h.patch).toHaveBeenCalledWith("/crews/crew/positions/position", {
    service: "aurora",
    data: { description: "New description" },
  });
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("positionEdit.saved");
});
it("requires returning after an uncertain edit", async () => {
  await renderEdit();
  await type("positionCreate.description", "New description");
  h.patch.mockRejectedValue(new Error("offline"));
  await click("positionEdit.save");
  expect(host.textContent).toContain("positionEdit.recheck");
  expect(button("positionEdit.save")).toBeUndefined();
});

it("loads the editor from the scoped server list", async () => {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("members/me")
      ? { userId: "manager", permissions: ["openings.manage"] }
      : { items: [editing], nextCursor: null }
  );
  await act(async () =>
    root.render(
      <PositionEdit
        crewId="crew"
        positionId="position"
        userId="manager"
        generation={1}
        onClose={h.close}
      />
    )
  );
  expect(
    (host.querySelector('[aria-label="positionCreate.description"]') as HTMLTextAreaElement).value
  ).toBe("Existing role");
});
it("does not render an editor when the position cannot be loaded", async () => {
  h.get.mockRejectedValue(new Error("permission denied"));
  await act(async () =>
    root.render(
      <PositionEdit
        crewId="crew"
        positionId="position"
        userId="manager"
        generation={1}
        onClose={h.close}
      />
    )
  );
  expect(host.textContent).toContain("permission denied");
  expect(button("positionEdit.save")).toBeUndefined();
});

it("keeps unchanged edits open without sending a write", async () => {
  await renderEdit();
  await click("positionEdit.save");
  expect(host.textContent).toContain("positionEdit.noChanges");
  expect(button("positionEdit.save")).toBeDefined();
  expect(h.patch).not.toHaveBeenCalled();
});

it("keeps selected qualification skills through foreground access refresh", async () => {
  const screen = (active: boolean) =>
    root.render(
      <PositionCreate
        crewId="crew"
        userId="manager"
        generation={1}
        active={active}
        onClose={h.close}
      />
    );
  await act(async () => screen(true));
  await type("positionCreate.description", "Direct the film");
  h.get.mockResolvedValueOnce({ skills: ["Editing"] });
  await click("crewSkills.label · 0/20");
  await click("Editing");
  await act(async () => screen(false));
  await act(async () => screen(true));
  await click("positionCreate.publish");
  expect(h.post).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ data: expect.objectContaining({ requiredSkills: ["Editing"] }) })
  );
});

it("removes an existing qualification skill without changing unrelated position terms", async () => {
  await renderEdit();
  h.get.mockResolvedValueOnce({ skills: ["Lighting"] });
  await click("crewSkills.label");
  await click("✓ Editing");
  h.patch.mockResolvedValue({ ...editing, requiredSkills: [] });
  await click("positionEdit.save");
  expect(h.patch).toHaveBeenCalledWith("/crews/crew/positions/position", {
    service: "aurora",
    data: { requiredSkills: [] },
  });
});
