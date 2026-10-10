import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

function createExitState() {
  const panels = new Map<string, { dirty: boolean; busy: boolean }>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    read: () =>
      [...panels.values()].some((p) => p.busy)
        ? "busy"
        : [...panels.values()].some((p) => p.dirty)
          ? "dirty"
          : "clean",
    set: (panel: string, dirty: boolean, busy: boolean) => {
      panels.set(panel, { dirty, busy });
      notify();
    },
    release: (panel: string) => {
      const previous = panels.get(panel);
      if (previous) panels.set(panel, { ...previous, busy: false });
      notify();
    },
    clear: (panel: string) => {
      panels.delete(panel);
      notify();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
const Context = createContext<ReturnType<typeof createExitState> | undefined>(undefined);
const noopSubscribe = () => () => {};
export function ServiceEditorExitState({ children }: { children: ReactNode }) {
  const [store] = useState(createExitState);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useServiceEditorExitStatus() {
  const store = useContext(Context);
  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.read ?? (() => "clean"),
    () => "clean"
  );
}
export function useClearServiceEditorExit() {
  const store = useContext(Context);
  return (panel: string) => store?.clear(panel);
}
export function useServiceEditorExit(panel: string, dirty: boolean, busy: boolean) {
  const store = useContext(Context);
  useLayoutEffect(() => {
    store?.set(panel, dirty, busy);
  }, [store, panel, dirty, busy]);
  // A refresh temporarily unmounts editors. Preserve their unsaved-state signal.
  useLayoutEffect(() => () => store?.release(panel), [store, panel]);
}
