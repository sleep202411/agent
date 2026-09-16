import { expect, it, vi } from "vitest";
vi.mock("@/src/lib/api", () => ({ backendApi: { post: vi.fn() }, api: { post: vi.fn() } }));
import {
  projectSlice,
  setProjectId,
  setBatchGeneratingActive,
  setBatchGenerating,
} from "./projectSlice";
it("clears the originating batch without clearing the selected project", () => {
  let state = projectSlice.reducer(undefined, setProjectId("old"));
  state = projectSlice.reducer(state, setBatchGeneratingActive(true));
  state = projectSlice.reducer(
    state,
    setBatchGenerating({ shotId: "shot", columnId: "col", generating: true })
  );
  state = projectSlice.reducer(state, setProjectId("new"));
  state = projectSlice.reducer(state, setBatchGeneratingActive(true));
  state = projectSlice.reducer(state, { type: "project/clearBatchGenerating", payload: "old" });
  expect(state.instances.old?.batchGeneratingActive).toBe(false);
  expect(state.instances.old?.batchGeneratingCells).toEqual({});
  expect(state.instances.new?.batchGeneratingActive).toBe(true);
});
it("preserves current-project clearing for existing callers", () => {
  let state = projectSlice.reducer(undefined, setProjectId("current"));
  state = projectSlice.reducer(state, setBatchGeneratingActive(true));
  state = projectSlice.reducer(state, { type: "project/clearBatchGenerating" });
  expect(state.instances.current?.batchGeneratingActive).toBe(false);
});
