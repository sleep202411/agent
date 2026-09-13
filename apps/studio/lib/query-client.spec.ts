// @vitest-environment jsdom

import { focusManager, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createStudioQueryClient } from "./query-client";

describe("Story permission refresh", () => {
  it.each(["workbench", "chapter-workbench", "script-workbench", "workbench-shell"])(
    "refreshes a stale %s viewer snapshot when the editor returns to the app",
    async (key) => {
      const client = createStudioQueryClient();
      const queryKey = ["story-studio", key, "project-1"];
      client.setQueryData(queryKey, { capabilities: ["story.read"] });
      const queryFn = vi.fn().mockResolvedValue({ capabilities: ["story.read", "story.edit"] });
      const observer = new QueryObserver(client, { queryKey, queryFn, refetchOnMount: false });
      focusManager.setFocused(false);
      client.mount();
      const unsubscribe = observer.subscribe(() => {});
      try {
        expect(observer.getCurrentResult().data).toEqual({ capabilities: ["story.read"] });
        expect(queryFn).not.toHaveBeenCalled();
        focusManager.setFocused(true);
        await vi.waitFor(() =>
          expect(observer.getCurrentResult().data).toEqual({
            capabilities: ["story.read", "story.edit"],
          })
        );
        expect(queryFn).toHaveBeenCalledOnce();
      } finally {
        unsubscribe();
        client.unmount();
        client.clear();
        focusManager.setFocused(undefined);
      }
    }
  );
});
