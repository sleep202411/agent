import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useWorkbenchDrafts } from "./use-workbench-drafts";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("preserves nested field values and the exact attempted import command across recovery", () => {
  const key = "fizz:workbench:v1:user:crew";
  const batch = {
    key: "episode:episode",
    title: "Reviewed",
    path: "/crews/crew/episodes/episode/task-template",
    body: {
      templateId: "template",
      templateVersion: 1,
      episodeVersion: 2,
      taskFields: [
        {
          templateKey: "script",
          values: [
            { fieldId: "number", value: 0 },
            { fieldId: "check", value: false },
            { fieldId: "select", value: ["a", "b"] },
          ],
        },
      ],
    },
    items: [],
    attempted: true,
  };
  window.localStorage.setItem(key, JSON.stringify({ version: 1, drafts: [], batches: [batch] }));
  let result!: ReturnType<typeof useWorkbenchDrafts>;
  function Probe() {
    result = useWorkbenchDrafts("user", "crew");
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  expect(result.storageError).toBe(false);
  expect(result.batches).toEqual([batch]);
  act(() => result.setBatches((current) => [...current]));
  expect(JSON.parse(window.localStorage.getItem(key)!).batches).toEqual([batch]);
  act(() => root.unmount());
  window.localStorage.removeItem(key);
});
