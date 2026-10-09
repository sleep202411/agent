import { useEffect, useState } from "react";
import {
  CanvasCardConflictError,
  type CanvasCardState,
} from "../../../canvas-editor/card-state-schema";
import { canonical } from "../../../canvas-editor/json-value";
import { canvasAuthoringEdit } from "./canvas-card-edit";
import type { CanvasGenerationSeed } from "./canvas-seed";
import type { GenerationDraft, generationDraft } from "./draft";
import type { GenerationModel } from "./catalog-api";

type Edit = { before: CanvasCardState; after: CanvasCardState };
type Options = {
  enabled: boolean;
  draft: GenerationDraft | null;
  model?: GenerationModel;
  mode?: string;
  seed?: CanvasGenerationSeed;
  store: ReturnType<typeof generationDraft>;
  saveDraft(draft: GenerationDraft): void;
  saveAuthoring?: (edit: Edit, signal: AbortSignal) => Promise<void>;
  getSignal(): AbortSignal | undefined;
  run(
    request: () => Promise<unknown>,
    success: () => void,
    failure: (error: unknown) => void
  ): Promise<void>;
};
/** The frozen checkpoint survives close/restart; only acknowledgement advances
 * the baseline. Uncertain saves require Retry, never an automatic rewrite. */
export function useCanvasAutosave(options: Options) {
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const { enabled, draft, model, mode, seed, store, saveDraft, saveAuthoring, getSignal, run } =
    options;
  useEffect(() => {
    const signal = getSignal();
    if (
      !enabled ||
      !draft ||
      !model ||
      !seed ||
      !saveAuthoring ||
      !signal ||
      signal.aborted ||
      error ||
      draft.canvasConflict ||
      draft.upload
    )
      return;
    const timer = setTimeout(() => {
      if (signal.aborted) return;
      let edit: Edit;
      try {
        edit = draft.canvasSave ?? canvasAuthoringEdit(seed, draft, model, mode);
        if (!draft.canvasSave && canonical(edit.before) === canonical(edit.after)) return;
      } catch {
        // Raw partial number/JSON/URL text remains durable locally while typing.
        return;
      }
      void run(
        async () => {
          saveDraft({ ...draft, canvasSave: edit });
          await saveAuthoring(edit, signal);
        },
        () => {
          const latest = store.read();
          if (latest) saveDraft({ ...latest, canvasBase: edit.after, canvasSave: undefined });
        },
        (cause) => {
          try {
            if (cause instanceof CanvasCardConflictError) {
              const latest = store.read();
              if (latest)
                saveDraft({ ...latest, canvasSave: undefined, canvasConflict: cause.current });
            } else setError(cause instanceof Error ? cause.message : String(cause));
          } catch (storageError) {
            setError(storageError instanceof Error ? storageError.message : String(storageError));
          }
        }
      );
    }, 800);
    return () => clearTimeout(timer);
  }, [
    enabled,
    draft,
    model,
    mode,
    seed,
    store,
    saveDraft,
    saveAuthoring,
    getSignal,
    run,
    error,
    retry,
  ]);
  return {
    error,
    retry: () => {
      setError(undefined);
      setRetry((value) => value + 1);
    },
  };
}
