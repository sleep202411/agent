import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { StoryWorkbench } from "@/lib/story-projects-api";
import { cacheStoryWorkbenchDraft } from "./story-workbench-cache";

describe("cacheStoryWorkbenchDraft", () => {
  it("updates the canvas and shared dock projections together", () => {
    const client = new QueryClient();
    const canvasKey = ["story-studio", "workbench", "project"] as const;
    const dockKey = ["story-studio", "chapter-workbench", "project"] as const;
    const current = {
      draft: { revision: 4, content: { storyBible: { stateVariables: [] } } },
    } as unknown as StoryWorkbench;
    const saved = {
      ...current.draft,
      revision: 5,
      content: {
        ...current.draft.content,
        storyBible: {
          ...current.draft.content.storyBible,
          stateVariables: [
            {
              key: "imported",
              name: { "en-US": "Imported" },
              valueType: "number" as const,
              initialValue: 0,
            },
          ],
        },
      },
    };
    client.setQueryData(canvasKey, current);
    client.setQueryData(dockKey, current);

    cacheStoryWorkbenchDraft(client, [canvasKey, dockKey], saved);

    expect(client.getQueryData<StoryWorkbench>(canvasKey)?.draft).toEqual(saved);
    expect(client.getQueryData<StoryWorkbench>(dockKey)?.draft).toEqual(saved);
  });

  it("does not replace a newer projection with an older save response", () => {
    const client = new QueryClient();
    const key = ["story-studio", "workbench", "project"] as const;
    const current = { draft: { revision: 7 } } as unknown as StoryWorkbench;
    const stale = { revision: 6 } as StoryWorkbench["draft"];
    client.setQueryData(key, current);

    cacheStoryWorkbenchDraft(client, [key], stale);

    expect(client.getQueryData<StoryWorkbench>(key)).toBe(current);
  });
});
