import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskPicker } from "./task-picker";
import type { TaskOption } from "./task-options";
const h = vi.hoisted(() => ({ generation: 1, active: true, select: vi.fn(), close: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./use-task-options", () => ({
  useTaskOptions: () => ({
    items: [
      { id: "self", number: 1, title: "Self" },
      { id: "other", number: 2, title: "Other" },
    ],
    loading: false,
    hasMore: false,
  }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TextInput: () => <input />,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    disabled,
    onPress,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  FlatList: ({
    data,
    renderItem,
  }: {
    data: TaskOption[];
    renderItem: (value: { item: TaskOption }) => ReactNode;
  }) => (
    <>
      {data.map((item) => (
        <div key={item.id}>{renderItem({ item })}</div>
      ))}
    </>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((item) => item.textContent === label)!;
beforeEach(async () => {
  vi.clearAllMocks();
  h.generation = 1;
  h.active = true;
  host = document.createElement("div");
  root = createRoot(host);
  await act(async () =>
    root.render(
      <TaskPicker
        crewId="crew"
        generation={1}
        onSelect={h.select}
        onClose={h.close}
        excludedIds={["self"]}
        title="Choose parent"
        closeLabel="Cancel"
      />
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("disables excluded tasks and selects another task only once", async () => {
  expect(host.textContent).toContain("Choose parent");
  expect(button("TASK-1 Self").disabled).toBe(true);
  await act(async () => {
    button("TASK-1 Self").click();
    button("TASK-2 Other").click();
    button("TASK-2 Other").click();
  });
  expect(h.select).toHaveBeenCalledExactlyOnceWith({ id: "other", number: 2, title: "Other" });
  await act(async () => button("Cancel").click());
  expect(h.close).toHaveBeenCalledOnce();
});
it("rejects selection after the account changes", async () => {
  h.generation = 2;
  await act(async () => button("TASK-2 Other").click());
  expect(h.select).not.toHaveBeenCalled();
});
