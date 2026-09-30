import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewStudioWorkspacePicker } from "./crew-studio-workspace-picker";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  userId: "alice",
  patch: vi.fn(),
  post: vi.fn(),
  sourceError: false,
  fetching: false,
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
  crewApi: {
    patch: (...args: unknown[]) => state.patch(...args),
    post: (...args: unknown[]) => state.post(...args),
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
  useQuery: () => ({
    data: [{ id: "workspace", name: "Workspace" }],
    isSuccess: !state.sourceError,
    isError: state.sourceError,
    isFetching: state.fetching,
  }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
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
async function render(
  crewId = "crew",
  disabled = false,
  value: { id: string; name: string } | null = null,
  legacyProject: { id: string; name: string } | null = null
) {
  await act(async () =>
    root.render(
      <CrewStudioWorkspacePicker
        crewId={crewId}
        disabled={disabled}
        value={value}
        legacyProject={legacyProject}
      />
    )
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
  state.sourceError = false;
  state.fetching = false;
  state.post.mockResolvedValue({
    studioWorkspace: { id: "new", name: "New Studio" },
    created: true,
  });
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
  expect(state.invalidate).toHaveBeenCalledTimes(3);
});
it("stops chained refreshes after leaving during asset recovery", async () => {
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

function button(label: string) {
  return [...container.querySelectorAll("button")].find((el) => el.textContent === label);
}
async function click(label: string) {
  await act(async () => button(label)!.click());
}
it("requires explicit confirmation, initializes once and refreshes affected queries", async () => {
  await render();
  await click("create");
  expect(state.post).not.toHaveBeenCalled();
  expect(container.textContent).toContain("createDescription");
  await click("createConfirm");
  expect(state.post).toHaveBeenCalledWith("/crews/crew/studio-workspace/initialize", {
    signal: expect.any(AbortSignal),
  });
  expect(state.post).toHaveBeenCalledTimes(1);
  expect(state.patch).not.toHaveBeenCalled();
  expect(state.invalidate).toHaveBeenCalledTimes(3);
  expect(container.querySelector("a")?.getAttribute("href")).toContain("ws=new");
  expect(button("create")).toBeUndefined();
});
it("cancels confirmation without creating a workspace", async () => {
  await render();
  await click("create");
  await click("createCancel");
  expect(button("createConfirm")).toBeUndefined();
  expect(state.post).not.toHaveBeenCalled();
});
it.each(["existing", "legacy", "disabled", "anonymous"])(
  "does not offer initialization for %s",
  async (kind) => {
    if (kind === "anonymous") state.userId = "";
    const ws = { id: "old", name: "Old" };
    await render(
      "crew",
      kind === "disabled",
      kind === "existing" ? ws : null,
      kind === "legacy" ? ws : null
    );
    expect(button("create")).toBeUndefined();
  }
);
it.each(["error", "fetching"])("blocks initialization when options are %s", async (kind) => {
  await render();
  await click("create");
  state.sourceError = kind === "error";
  state.fetching = kind === "fetching";
  await render();
  expect(button("createConfirm")?.disabled).toBe(true);
  await click("createConfirm");
  expect(state.post).not.toHaveBeenCalled();
});
it("prevents duplicate creation and retains confirmation after failure", async () => {
  const pending = deferred();
  state.post.mockReturnValueOnce(pending.promise);
  await render();
  await click("create");
  await act(async () => {
    button("createConfirm")!.click();
    button("createConfirm")!.click();
  });
  expect(state.post).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error("Legacy link appeared")));
  expect(container.textContent).toContain("Legacy link appeared");
  await click("createConfirm");
  expect(state.post).toHaveBeenCalledTimes(2);
});
it("hides confirmation when an existing link arrives before submission", async () => {
  await render();
  await click("create");
  await render("crew", false, { id: "other", name: "Other" });
  expect(button("createConfirm")).toBeUndefined();
  expect(state.post).not.toHaveBeenCalled();
});
it("suppresses an abandoned initialization result after switching accounts", async () => {
  let resolve!: (value: unknown) => void;
  state.post.mockReturnValueOnce(
    new Promise((yes) => {
      resolve = yes;
    })
  );
  await render();
  await click("create");
  await click("createConfirm");
  state.userId = "bob";
  await render();
  expect(state.post.mock.calls[0]![1].signal.aborted).toBe(true);
  await act(async () =>
    resolve({ studioWorkspace: { id: "old", name: "Old result" }, created: true })
  );
  expect(container.textContent).not.toContain("Old result");
  expect(state.invalidate).not.toHaveBeenCalled();
  expect(button("createConfirm")).toBeUndefined();
});

it("uses an existing workspace recovered by the server and does not repeat creation after refresh failure", async () => {
  state.post.mockResolvedValueOnce({
    studioWorkspace: { id: "recovered", name: "Recovered" },
    created: false,
  });
  state.invalidate.mockRejectedValueOnce(new Error("Refresh unavailable"));
  await render();
  await click("create");
  await click("createConfirm");
  expect(button("create")).toBeUndefined();
  expect(container.querySelector("a")?.getAttribute("href")).toContain("ws=recovered");
  expect(state.post).toHaveBeenCalledTimes(1);
  await render("crew", false, { id: "recovered", name: "Recovered" });
  await render();
  expect(button("create")).toBeDefined();
  expect(container.querySelector("a")).toBeNull();
});

it("blocks cached workspace choices after a failed source refresh and recovers after retry", async () => {
  await render();
  state.sourceError = true;
  await render();
  await act(async () => state.actions.at(-1)!());
  expect(state.patch).not.toHaveBeenCalled();
  state.sourceError = false;
  await render();
  await act(async () => state.actions.at(-1)!());
  expect(state.patch).toHaveBeenCalledTimes(1);
});

it("opens the linked Studio workspace in a separate tab for a crew member", async () => {
  await render("crew", true, { id: "workspace", name: "Workspace" });
  const link = container.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("/studio/projects?ws=workspace");
  expect(link.target).toBe("_blank");
  expect(link.rel).toBe("noopener noreferrer");
  expect(state.patch).not.toHaveBeenCalled();
});
