import { beforeEach, describe, expect, it } from "vitest";
import { useStoryProjectUiStore } from "./story-project-ui-store";

describe("Story project FizzAgent composer bridge", () => {
  beforeEach(() => {
    useStoryProjectUiStore.setState({
      mobileView: "work",
      composerPrefillSequence: 0,
      composerPrefillRequest: null,
    });
  });

  it("switches phones to chat and publishes a one-shot natural-language prefill", () => {
    useStoryProjectUiStore.getState().openAgentComposer("Prepare Asset Specs for review.");

    expect(useStoryProjectUiStore.getState()).toMatchObject({
      mobileView: "chat",
      composerPrefillSequence: 1,
      composerPrefillRequest: { id: 1, text: "Prepare Asset Specs for review." },
    });
  });

  it("only consumes the matching request and keeps ids monotonic", () => {
    useStoryProjectUiStore.getState().openAgentComposer("First");
    useStoryProjectUiStore.getState().consumeComposerPrefill(99);
    expect(useStoryProjectUiStore.getState().composerPrefillRequest?.text).toBe("First");

    useStoryProjectUiStore.getState().consumeComposerPrefill(1);
    expect(useStoryProjectUiStore.getState().composerPrefillRequest).toBeNull();

    useStoryProjectUiStore.getState().openAgentComposer("Second");
    expect(useStoryProjectUiStore.getState().composerPrefillRequest).toEqual({
      id: 2,
      text: "Second",
    });
  });
});
