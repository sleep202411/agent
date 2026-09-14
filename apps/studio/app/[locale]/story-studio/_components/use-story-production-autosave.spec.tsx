// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStoryProductionAutosave } from "./use-story-production-autosave";

describe("production prompt autosave", () => {
  let root: Root;
  let container: HTMLDivElement;
  let editor: ReturnType<typeof useStoryProductionAutosave<{ prompt: string }>>;
  const persist = vi.fn<(values: { prompt: string }) => Promise<number>>();
  const onError = vi.fn();

  function Editor({ prompt = "Initial" }: { prompt?: string }) {
    editor = useStoryProductionAutosave({ initialValues: { prompt }, persist, onError });
    return (
      <input
        value={editor.values.prompt}
        onChange={(event) => editor.changeValues({ prompt: event.target.value })}
      />
    );
  }

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.resetAllMocks();
    persist.mockResolvedValue(2);
    container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root.render(<Editor />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
  });

  async function edit(prompt: string) {
    await act(async () => editor.changeValues({ prompt }));
  }

  it("saves the latest typing automatically without saving on mount", async () => {
    expect(persist).not.toHaveBeenCalled();
    await edit("A");
    await edit("Latest prompt");
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(persist.mock.calls).toEqual([[{ prompt: "Latest prompt" }]]);
  });

  it("flushes current input immediately on Generate and cancels its pending timer", async () => {
    await edit("Latest prompt");
    const submit = vi.fn().mockResolvedValue("accepted");
    await act(async () => {
      await editor.runWithSavedValues(submit);
    });
    expect(persist).toHaveBeenCalledWith({ prompt: "Latest prompt" });
    expect(submit).toHaveBeenCalledWith(2);
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(persist).toHaveBeenCalledOnce();
  });

  it("serializes an in-flight save, the clicked prompt, admission, and later typing", async () => {
    let finishFirstSave!: (version: number) => void;
    let finishAdmission!: () => void;
    persist.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirstSave = resolve;
        })
    );
    const submit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishAdmission = resolve;
        })
    );
    await edit("A");
    await act(async () => vi.advanceTimersByTimeAsync(400));
    await edit("B");
    let run!: Promise<void>;
    await act(async () => {
      run = editor.runWithSavedValues(submit);
    });
    await edit("C");
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(persist.mock.calls).toEqual([[{ prompt: "A" }]]);
    expect(container.querySelector("input")?.value).toBe("C");
    await act(async () => finishFirstSave(1));
    expect(persist.mock.calls).toEqual([[{ prompt: "A" }], [{ prompt: "B" }]]);
    expect(submit).toHaveBeenCalledWith(2);
    await act(async () => {
      finishAdmission();
      await run;
    });
    expect(persist.mock.calls).toEqual([[{ prompt: "A" }], [{ prompt: "B" }], [{ prompt: "C" }]]);
  });

  it("flushes pending edits when navigating away", async () => {
    await edit("Last edit");
    await act(async () => root.render(null));
    expect(persist).toHaveBeenCalledWith({ prompt: "Last edit" });
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(persist).toHaveBeenCalledOnce();
  });

  it("preserves newer input when an older save updates the parent", async () => {
    await edit("Newer input");
    const input = container.querySelector("input");
    await act(async () => root.render(<Editor prompt="Older save" />));
    expect(container.querySelector("input")).toBe(input);
    expect(input?.value).toBe("Newer input");
  });

  it("accepts external updates when the local input has no edits", async () => {
    await act(async () => root.render(<Editor prompt="Collaborator edit" />));
    expect(container.querySelector("input")?.value).toBe("Collaborator edit");
    expect(persist).not.toHaveBeenCalled();
  });

  it("reports autosave failures and lets a later edit recover", async () => {
    const error = new Error("Connection lost");
    persist.mockRejectedValueOnce(error);
    await edit("First edit");
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(onError).toHaveBeenCalledWith(error);
    await edit("Next edit");
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(persist).toHaveBeenLastCalledWith({ prompt: "Next edit" });
  });

  it("does not admit a generation if the current prompt cannot be saved", async () => {
    const error = new Error("Version conflict");
    persist.mockRejectedValueOnce(error);
    await edit("Unpersisted edit");
    const submit = vi.fn();
    await act(async () => {
      await expect(editor.runWithSavedValues(submit)).rejects.toBe(error);
    });
    expect(submit).not.toHaveBeenCalled();
  });
});
