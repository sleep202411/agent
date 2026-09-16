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
  let currentAccount = "alice";

  function Editor({
    prompt = "Initial",
    owner = "alice",
    save = persist,
  }: {
    prompt?: string;
    owner?: string;
    save?: typeof persist;
  }) {
    editor = useStoryProductionAutosave({
      initialValues: { prompt },
      persist: save,
      onError,
      canPersist: () => currentAccount === owner,
      scopeKey: owner,
    });
    return (
      <input
        value={editor.values.prompt}
        onChange={(event) => editor.changeValues({ prompt: event.target.value })}
      />
    );
  }

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    currentAccount = "alice";
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
  it("does not flush old-account typing or accept retained callbacks after account replacement", async () => {
    await edit("Private edit");
    const retained = editor;
    currentAccount = "bob";
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(persist).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    await expect(retained.runWithSavedValues(vi.fn())).rejects.toMatchObject({
      name: "AbortError",
    });
    retained.changeValues({ prompt: "abandoned" });
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(persist).not.toHaveBeenCalled();
  });

  it("does not start generation after a save finishes in an abandoned view", async () => {
    let finish!: (version: number) => void;
    persist.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const submit = vi.fn();
    let run!: Promise<unknown>;
    await act(async () => {
      run = editor.runWithSavedValues(submit);
    });
    const rejection = expect(run).rejects.toMatchObject({ name: "AbortError" });
    await act(async () => root.render(null));
    await act(async () => {
      finish(2);
      await rejection;
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps scheduled typing bound to its captured persistence callback", async () => {
    await edit("Original target");
    const otherPersist = vi.fn().mockResolvedValue(3);
    await act(async () => root.render(<Editor save={otherPersist} />));
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(persist).toHaveBeenCalledWith({ prompt: "Original target" });
    expect(otherPersist).not.toHaveBeenCalled();
  });

  it("suppresses delayed autosave errors after the observed account changes", async () => {
    let fail!: (error: Error) => void;
    persist.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    await edit("Pending edit");
    await act(async () => vi.advanceTimersByTimeAsync(400));
    currentAccount = "bob";
    await act(async () => fail(new Error("Old failure")));
    expect(onError).not.toHaveBeenCalled();
  });
});
