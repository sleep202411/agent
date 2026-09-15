import { describe, expect, it, vi } from "vitest";
vi.mock("@/src/lib/api", () => ({ backendApi: {} }));
import {
  taskSlice,
  setTaskOwner,
  setTasks,
  reconcileTaskSnapshot,
  applyEvent,
  removeTask,
  addTask,
  type Task,
} from "./taskSlice";
const task = (id: string): Task => ({
  id,
  type: "image",
  source: "server",
  status: "pending",
  input: {},
  createdAt: 1,
  updatedAt: 1,
});
const reduce = taskSlice.reducer;
describe("task snapshot reconciliation", () => {
  it("retains progress received during the read", () => {
    let state = reduce(undefined, setTasks([task("a")]));
    const baseline = state.tasks;
    state = reduce(
      state,
      applyEvent({ taskId: "a", status: "completed", progress: 100, output: { url: "ready" } })
    );
    state = reduce(state, reconcileTaskSnapshot({ baseline, tasks: [task("a")] }));
    expect(state.tasks.a.status).toBe("completed");
    expect(state.tasks.a.output?.url).toBe("ready");
  });
  it("preserves new realtime and local tasks absent from the snapshot", () => {
    let state = reduce(undefined, setTasks([]));
    const baseline = state.tasks;
    state = reduce(state, applyEvent({ taskId: "remote", type: "video", status: "running" }));
    state = reduce(state, addTask({ id: "local", type: "image", input: {} }));
    state = reduce(state, reconcileTaskSnapshot({ baseline, tasks: [] }));
    expect(Object.keys(state.tasks).sort()).toEqual(["local", "remote"]);
  });
  it("does not resurrect a task removed while the read was pending", () => {
    let state = reduce(undefined, setTasks([task("a")]));
    const baseline = state.tasks;
    state = reduce(state, removeTask("a"));
    state = reduce(state, reconcileTaskSnapshot({ baseline, tasks: [task("a")] }));
    expect(state.tasks.a).toBeUndefined();
  });
  it("refreshes unchanged server tasks and removes absent unchanged server records", () => {
    let state = reduce(undefined, setTasks([task("a"), task("gone")]));
    const baseline = state.tasks;
    state = reduce(
      state,
      reconcileTaskSnapshot({ baseline, tasks: [{ ...task("a"), status: "completed" }] })
    );
    expect(state.tasks.a.status).toBe("completed");
    expect(state.tasks.gone).toBeUndefined();
  });
  it("keeps local queue state even when the snapshot includes the same id", () => {
    let state = reduce(
      undefined,
      addTask({ id: "local", type: "image", input: { prompt: "draft" } })
    );
    const baseline = state.tasks;
    state = reduce(state, reconcileTaskSnapshot({ baseline, tasks: [task("local")] }));
    expect(state.tasks.local.source).toBe("local");
    expect(state.tasks.local.input.prompt).toBe("draft");
  });
});

it("keeps same-account local work across panel remount and clears it on account change", () => {
  let state = reduce(undefined, setTaskOwner("a"));
  state = reduce(state, addTask({ id: "local", type: "image", input: {} }));
  const before = state;
  state = reduce(state, setTaskOwner("a"));
  expect(state).toBe(before);
  state = reduce(state, setTaskOwner("b"));
  expect(state.tasks).toEqual({});
  expect(state.ownerId).toBe("b");
});
it("clears owned tasks on logout", () => {
  let state = reduce(undefined, setTaskOwner("a"));
  state = reduce(state, setTasks([task("a")]));
  state = reduce(state, setTaskOwner(null));
  expect(state.tasks).toEqual({});
});

it("keeps Java/server tasks outside a recent-work snapshot's namespaces", () => {
  let state = reduce(undefined, setTasks([task("java-image-1"), task("agent:gone")]));
  const baseline = state.tasks;
  state = reduce(
    state,
    reconcileTaskSnapshot({
      tasks: [],
      baseline,
      managedIdPrefixes: ["ai:", "agent:", "production:", "build:"],
    })
  );
  expect(state.tasks["java-image-1"]).toBeDefined();
  expect(state.tasks["agent:gone"]).toBeUndefined();
});
