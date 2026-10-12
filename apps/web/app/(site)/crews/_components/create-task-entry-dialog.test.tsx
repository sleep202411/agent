import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreateTaskEntryDialog } from "./create-task-entry-dialog";
const h = vi.hoisted(() => ({
  id: "alice" as string | null,
  permissions: ["tasks.view"],
  fetching: false,
  failed: false,
  auth: vi.fn(),
  change: vi.fn(),
  newCrew: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: h.id ? { id: h.id } : null }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: h.auth }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "zh-CN",
  useTranslations: () => (key: string) => key,
}));
vi.mock("../_hooks/use-crew-list", () => ({
  useMyCrews: () => ({
    data: { founded: [{ id: "crew", name: "My Crew" }], joined: [{ id: "crew", name: "My Crew" }] },
    isPending: false,
    isError: false,
  }),
}));
vi.mock("../_hooks/use-members", () => ({
  useCrewMembership: () => ({
    data: { permissions: h.permissions },
    isFetching: h.fetching,
    isPending: false,
    isError: h.failed,
    error: new Error("Access check failed"),
    refetch: h.retry,
  }),
}));
vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({
    onChange,
    ...props
  }: Omit<ComponentProps<"select">, "onChange"> & { onChange: (value: string) => void }) => (
    // Native select is a test adapter for the themed dropdown.
    // eslint-disable-next-line no-restricted-syntax
    <select {...props} onChange={(e) => onChange(e.target.value)} />
  ),
  NativeSelectOption: (props: ComponentProps<"option">) => <option {...props} />,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  h.id = "alice";
  h.permissions = ["tasks.view"];
  h.fetching = false;
  h.failed = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});
const render = () =>
  act(() =>
    root.render(<CreateTaskEntryDialog open onOpenChange={h.change} onNewCrew={h.newCrew} />)
  );
const select = () =>
  act(() => {
    const el = document.querySelector("select")!;
    el.value = "crew";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
const button = (name: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === name)!;
it("resumes the chooser after sign-in without creating a Crew", () => {
  h.id = null;
  render();
  act(() => button("signIn").click());
  expect(h.change).toHaveBeenCalledWith(false);
  expect(h.newCrew).not.toHaveBeenCalled();
  act(() => h.auth.mock.calls[0]![0].onSuccess());
  expect(h.change).toHaveBeenLastCalledWith(true);
});
it("deduplicates Crews and links a permitted selection directly to task creation", () => {
  render();
  expect(document.querySelectorAll('option[value="crew"]')).toHaveLength(1);
  select();
  expect(document.querySelector("a")?.getAttribute("href")).toBe(
    "/zh-CN/crews/crew/workspace?tab=tasks&createTask=1"
  );
});
it("withholds entry while permissions refresh or fail and supports retry", () => {
  render();
  select();
  h.fetching = true;
  render();
  expect(document.querySelector("a")).toBeNull();
  h.fetching = false;
  h.failed = true;
  render();
  expect(document.body.textContent).toContain("Access check failed");
  act(() => button("retry").click());
  expect(h.retry).toHaveBeenCalled();
  expect(document.querySelector("a")).toBeNull();
});
it("blocks members without task management and clears selection on account changes", () => {
  h.permissions = [];
  render();
  select();
  expect(document.body.textContent).toContain("cannotManage");
  expect(document.querySelector("a")).toBeNull();
  h.id = "bob";
  h.permissions = ["tasks.view"];
  render();
  expect(document.querySelector("select")?.value).toBe("");
  expect(document.querySelector("a")).toBeNull();
});
it("hands new Crew creation to the existing eligibility flow", () => {
  render();
  act(() => button("newCrew").click());
  expect(h.newCrew).toHaveBeenCalledTimes(1);
});

it("opens direct position creation only with openings management permission", () => {
  const selected = vi.fn();
  const show = () =>
    act(() =>
      root.render(
        <CreateTaskEntryDialog
          mode="position"
          open
          onOpenChange={h.change}
          onNewCrew={h.newCrew}
          onSelectCrew={selected}
        />
      )
    );
  show();
  select();
  expect(document.body.textContent).toContain("cannotManagePositions");
  expect(button("continuePosition")).toBeUndefined();
  h.permissions = ["openings.manage"];
  show();
  act(() => button("continuePosition").click());
  expect(selected).toHaveBeenCalledWith("crew");
  expect(document.querySelector("a")).toBeNull();
});
