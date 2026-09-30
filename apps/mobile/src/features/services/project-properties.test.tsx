import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ProjectProperties } from "./project-properties";
import { valuesOf } from "./project-properties-api";
const h = vi.hoisted(() => ({ generation: 1, remove: vi.fn(), close: vi.fn(), read: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./project-properties-api", async (original) => ({
  ...(await original<typeof import("./project-properties-api")>()),
  fetchProjectProperties: h.read,
  updateProjectProperties: h.remove,
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("./user-displays", () => ({ useUserDisplays: () => new Map() }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (v: string) => void;
    editable: boolean;
  }) => <input disabled={!editable} value={value} onChange={(e) => onChangeText(e.target.value)} />,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const data = {
  project: {
    crewId: "crew",
    version: 1,
    status: "planned" as const,
    priority: null,
    leadMemberId: null,
    startDate: null,
    startDateGranularity: "day" as const,
    targetDate: null,
    targetDateGranularity: "day" as const,
  },
  labels: [],
  labelOptions: [],
  capabilities: { manage: true },
  members: [],
  canChooseLead: true,
};
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (text: string) => act(async () => button(text)!.click());
const render = () =>
  act(async () =>
    root.render(<ProjectProperties crewId="crew" userId="actor" generation={1} onClose={h.close} />)
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.remove.mockResolvedValue(undefined);
  h.read.mockResolvedValue(data);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("requires a change and confirmation before saving", async () => {
  await render();
  expect(button("projectProperties.review")!.disabled).toBe(true);
  await click("projectProperties.in_progress");
  await click("projectProperties.review");
  expect(h.remove).not.toHaveBeenCalled();
  await click("projectProperties.save");
  expect(h.remove).toHaveBeenCalledWith("crew", "actor", 1, data, {
    ...valuesOf(data),
    status: "in_progress",
  });
  expect(h.read).toHaveBeenCalledTimes(2);
});
it("shows a read-only project without management permission", async () => {
  h.read.mockResolvedValue({ ...data, capabilities: { manage: false } });
  await render();
  expect(host.textContent).toContain("projectProperties.readOnly");
  expect(button("projectProperties.review")).toBeUndefined();
  expect(button("projectProperties.in_progress")!.disabled).toBe(true);
});
it("preserves failures until an explicit refresh", async () => {
  h.remove.mockRejectedValue(new Error("Version conflict"));
  await render();
  await click("projectProperties.in_progress");
  await click("projectProperties.review");
  await click("projectProperties.save");
  expect(host.textContent).toContain("Version conflict");
  expect(button("projectProperties.save")!.disabled).toBe(true);
  await click("thread.refresh");
  expect(h.read).toHaveBeenCalledTimes(2);
});
it("blocks duplicate saves and navigation while pending", async () => {
  let finish!: () => void;
  h.remove.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await click("projectProperties.in_progress");
  await click("projectProperties.review");
  await act(async () => {
    button("projectProperties.save")!.click();
    button("projectProperties.save")!.click();
  });
  expect(h.remove).toHaveBeenCalledTimes(1);
  expect(button("crewTasks.back")!.disabled).toBe(true);
  await act(async () => finish());
});
it("blocks stale-account writes", async () => {
  await render();
  await click("projectProperties.in_progress");
  await click("projectProperties.review");
  h.generation = 2;
  await click("projectProperties.save");
  expect(h.remove).not.toHaveBeenCalled();
});
