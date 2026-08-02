import { Extension, type CommandProps } from "@tiptap/core";

export interface UiState {
  lockDragHandle: boolean;
  isDragging: boolean;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    uiState: {
      setLockDragHandle: (value: boolean) => ReturnType;

      resetUiState: () => ReturnType;
      setIsDragging: (value: boolean) => ReturnType;
    };
  }

  interface Storage {
    uiState: UiState;
  }
}

export const defaultUiState: UiState = {
  lockDragHandle: false,
  isDragging: false,
} as const;

export const UiState = Extension.create<UiState>({
  name: "uiState",

  addStorage() {
    return {
      uiState: { ...defaultUiState },
    };
  },

  addCommands() {
    // Every setter both mutates the storage AND stamps a meta-only
    // transaction (no document steps). React consumers read the storage via
    // `useEditorState`, which only recomputes on transactions — a silent
    // storage mutation would leave the UI stale until some unrelated
    // transaction happens to land (e.g. a collab sync step). The mutation
    // only runs when `dispatch` is set, so `can()` dry-runs stay pure.
    const createBooleanSetter =
      (key: keyof UiState) =>
      (value: boolean) =>
      ({ tr, dispatch }: CommandProps) => {
        if (dispatch) {
          this.storage[key] = value;
          tr.setMeta("uiStateUpdate", key);
        }
        return true;
      };

    return {
      // Drag handle commands
      setLockDragHandle: createBooleanSetter("lockDragHandle"),
      setIsDragging: createBooleanSetter("isDragging"),

      // Reset command
      resetUiState:
        () =>
        ({ tr, dispatch }: CommandProps) => {
          if (dispatch) {
            Object.assign(this.storage, { ...defaultUiState });
            tr.setMeta("uiStateUpdate", "reset");
          }
          return true;
        },
    };
  },

  onCreate() {
    this.storage = { ...defaultUiState };
  },
});
