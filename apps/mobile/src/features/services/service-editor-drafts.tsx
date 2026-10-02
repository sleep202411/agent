import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

const Drafts = createContext<Map<string, unknown> | undefined>(undefined);
/** Route/account-scoped memory survives a service reload, but never a different session. */
export function ServiceEditorDrafts({ children }: { children: ReactNode }) {
  const [store] = useState(() => new Map<string, unknown>());
  return <Drafts.Provider value={store}>{children}</Drafts.Provider>;
}
export function useServiceEditorState<T>(
  key: string,
  initial: T | (() => T)
): [T, Dispatch<SetStateAction<T>>] {
  const store = useContext(Drafts);
  const [value, setValue] = useState<T>(() => {
    if (store?.has(key)) return store.get(key) as T;
    const result = typeof initial === "function" ? (initial as () => T)() : initial;
    store?.set(key, result);
    return result;
  });
  return [
    value,
    (update) =>
      setValue((previous) => {
        const next = typeof update === "function" ? (update as (value: T) => T)(previous) : update;
        store?.set(key, next);
        return next;
      }),
  ];
}
export function useClearServiceEditorDraft(panel: string) {
  const store = useContext(Drafts);
  // Closed panels should initialize from fresh service data after a reload.
  useState(() => {
    if (store?.get(`${panel}:open`) !== true)
      for (const key of store?.keys() ?? []) if (key.startsWith(`${panel}:`)) store?.delete(key);
    return undefined;
  });
  return () => {
    for (const key of store?.keys() ?? []) if (key.startsWith(`${panel}:`)) store?.delete(key);
  };
}
