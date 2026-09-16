import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewStudioWorkspacePicker } from "./crew-studio-workspace-picker";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  userId: "alice",
  patch: vi.fn(),
  invalidate: vi.fn(),
  actions: [] as (() => void)[],
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: state.userId } }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/lib/region/cell", () => ({ getStudioHref: () => "/studio" }));
vi.mock("@/app/(site)/crews/_hooks/api", () => ({
  crewApi: { patch: (...args: unknown[]) => state.patch(...args) },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
  useQuery: () => ({ data: [{ id: "workspace", name: "Workspace" }] }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));
vi.mock("@/components/ui/popover", () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { Popover: Box, PopoverContent: Box, PopoverTrigger: Box };
});
vi.mock("@/components/ui/command", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Command: Box,
    CommandInput: Box,
    CommandList: Box,
    CommandEmpty: Box,
    CommandItem: ({ onSelect, children }: { onSelect: () => void; children: ReactNode }) => {
      state.actions.push(onSelect);
      return <button onClick={onSelect}>{children}</button>;
    },
  };
});
const container = document.createElement("div");
document.body.appendChild(container);
let root = createRoot(container);
async function render(crewId = "crew", disabled = false) {
  await act(async () =>
    root.render(<CrewStudioWorkspacePicker crewId={crewId} disabled={disabled} value={null} />)
  );
}
function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  state.userId = "alice";
  state.actions = [];
  state.patch.mockResolvedValue(undefined);
  state.invalidate.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.resetAllMocks();
});
it.each(["account", "crew", "authority", "unmount"])(
  "rejects retained selection after %s replacement",
  async (change) => {
    await render();
    const old = state.actions[0]!;
    if (change === "account") state.userId = "bob";
    if (change === "unmount") await act(async () => root.render(null));
    else await render(change === "crew" ? "other" : "crew", change === "authority");
    await act(async () => old());
    expect(state.patch).not.toHaveBeenCalled();
  }
);
it("blocks anonymous and duplicate actions while permitting retry", async () => {
  state.userId = "";
  await render();
  await act(async () => state.actions.at(-1)!());
  expect(state.patch).not.toHaveBeenCalled();
  state.userId = "alice";
  await render();
  const pending = deferred();
  state.patch.mockReturnValueOnce(pending.promise);
  const select = state.actions.at(-1)!;
  await act(async () => {
    select();
    select();
  });
  expect(state.patch).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error("retry")));
  expect(container.textContent).toContain("retry");
  await act(async () => select());
  expect(state.patch).toHaveBeenCalledTimes(2);
});
it("aborts abandoned saves and preserves the replacement operation", async () => {
  const first = deferred();
  const replacement = deferred();
  state.patch.mockReturnValueOnce(first.promise).mockReturnValueOnce(replacement.promise);
  await render();
  await act(async () => state.actions.at(-1)!());
  const signal = state.patch.mock.calls[0]![1].signal as AbortSignal;
  state.userId = "bob";
  await render();
  expect(signal.aborted).toBe(true);
  const select = state.actions.at(-1)!;
  await act(async () => select());
  await act(async () => first.reject(new Error("obsolete")));
  expect(container.textContent).not.toContain("obsolete");
  await act(async () => select());
  expect(state.patch).toHaveBeenCalledTimes(2);
  await act(async () => replacement.resolve());
  expect(state.invalidate).toHaveBeenCalledTimes(2);
});
it("stops chained refreshes after leaving during overview recovery", async () => {
  const refresh = deferred();
  state.invalidate.mockReturnValueOnce(refresh.promise);
  await render();
  await act(async () => state.actions.at(-1)!());
  expect(state.invalidate).toHaveBeenCalledTimes(1);
  state.userId = "bob";
  await render();
  await act(async () => refresh.resolve());
  expect(state.invalidate).toHaveBeenCalledTimes(1);
});
