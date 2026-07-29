import { describe, expect, it } from "vitest";

import type { CrewTaskDTO } from "../_hooks/types";
import {
  boardOrdersEqual,
  createBoardOrder,
  moveBoardTask,
  optimisticallyReorderCrewTasks,
  placementForTask,
} from "./task-board-ordering";

const states = {
  open: {
    id: "state-open",
    semantic: "open",
    name: "To do",
  },
  in_progress: {
    id: "state-progress",
    semantic: "in_progress",
    name: "In progress",
  },
  submitted: {
    id: "state-review",
    semantic: "submitted",
    name: "In review",
  },
  revision_requested: {
    id: "state-revision",
    semantic: "revision_requested",
    name: "Changes requested",
  },
} as const;

function task(id: string, status: keyof typeof states, rank: number, version = 1): CrewTaskDTO {
  const state = states[status];
  return {
    id,
    status,
    workflowStateId: state.id,
    workflowState: {
      ...state,
      crewId: "crew",
      color: "#8B919B",
      systemKey: status,
      position: 0,
      archived: false,
      version: 1,
      createdByUserId: "owner",
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    },
    rank: String(rank),
    version,
    cycleId: null,
    updatedAt: "2026-07-29T00:00:00.000Z",
  } as CrewTaskDTO;
}

describe("crew task board ordering", () => {
  const stateIds = Object.values(states).map((state) => state.id);
  const tasks = [
    task("a", "open", 1024),
    task("b", "open", 2048, 4),
    task("c", "open", 3072),
    task("d", "in_progress", 1024, 2),
  ];

  it("moves within a column using the final post-removal index", () => {
    const initial = createBoardOrder(tasks, stateIds);
    const moved = moveBoardTask(initial, "a", states.open.id, 2);

    expect(moved[states.open.id]).toEqual(["b", "c", "a"]);
    expect(initial[states.open.id]).toEqual(["a", "b", "c"]);
    expect(moveBoardTask(moved, "a", states.open.id, 2)).toBe(moved);
  });

  it("moves across columns and resolves stable adjacent anchors", () => {
    const moved = moveBoardTask(createBoardOrder(tasks, stateIds), "b", states.in_progress.id, 0);

    expect(moved[states.open.id]).toEqual(["a", "c"]);
    expect(moved[states.in_progress.id]).toEqual(["b", "d"]);
    expect(placementForTask(moved, "b")).toEqual({
      workflowStateId: states.in_progress.id,
      beforeTaskId: null,
      afterTaskId: "d",
    });
  });

  it("moves into an empty column and detects a no-op order", () => {
    const initial = createBoardOrder(tasks, stateIds);
    const moved = moveBoardTask(initial, "d", states.revision_requested.id, 0);

    expect(moved[states.revision_requested.id]).toEqual(["d"]);
    expect(boardOrdersEqual(initial, moved)).toBe(false);
    expect(
      boardOrdersEqual(moved, moveBoardTask(moved, "d", states.revision_requested.id, 0))
    ).toBe(true);
  });

  it("applies the same provisional midpoint rank and version increment as the server", () => {
    const optimistic = optimisticallyReorderCrewTasks(
      tasks,
      "d",
      {
        expectedVersion: 2,
        beforeTaskId: "a",
        beforeTaskVersion: 1,
        afterTaskId: "b",
        afterTaskVersion: 4,
        workflowStateId: states.open.id,
      },
      tasks[0]!.workflowState
    );
    const moved = optimistic.find((candidate) => candidate.id === "d");

    expect(moved).toMatchObject({
      status: "open",
      workflowStateId: states.open.id,
      rank: "1536",
      version: 3,
    });
    expect(tasks.find((candidate) => candidate.id === "d")).toMatchObject({
      status: "in_progress",
      version: 2,
    });
  });
});
