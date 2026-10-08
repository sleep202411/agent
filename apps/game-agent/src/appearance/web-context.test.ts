import { expect, it } from "vitest";
import type { AppearanceDesignRequest } from "@repo/game-agent-protocol";
import { reconcileAppearanceWebContext } from "./web-context.js";
it("reuses the same admission on reload and revokes it when editable content changes", () => {
  const previous: AppearanceDesignRequest = {
    requestId: "old",
    prompt: "Design",
    locale: "en-US",
    appearance: { version: 1 },
    gameUi: null,
    context: { title: "Home", choiceLabels: [] },
    history: [],
  };
  expect(reconcileAppearanceWebContext(previous, { ...previous, requestId: "new" })).toBe(previous);
  const changed = {
    ...previous,
    requestId: "new",
    appearance: { ...previous.appearance, presentation: { copy: { start: { "en-US": "Enter" } } } },
  };
  expect(reconcileAppearanceWebContext(previous, changed)).toBe(changed);
});
