import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

function createReceipts() {
  const values = new Map<string, string>();
  const listeners = new Set<() => void>();
  return {
    get: (key: string) => values.get(key),
    set: (key: string, value: string | undefined) => {
      if (value === undefined) values.delete(key);
      else values.set(key, value);
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
const Receipts = createContext<ReturnType<typeof createReceipts> | undefined>(undefined);
const noSubscribe = () => () => {};
export function useServiceReceipt(panel: string) {
  const store = useContext(Receipts);
  const id = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    () => store?.get(panel),
    () => undefined
  );
  return {
    id,
    save: (value: string) => store?.set(panel, value),
    clear: () => store?.set(panel, undefined),
  };
}
const Drafts = createContext<Map<string, unknown> | undefined>(undefined);
/** Route/account-scoped memory survives a service reload, but never a different session. */
export function ServiceEditorDrafts({ children }: { children: ReactNode }) {
  const [store] = useState(() => new Map<string, unknown>());
  const [receipts] = useState(createReceipts);
  return (
    <Receipts.Provider value={receipts}>
      <Drafts.Provider value={store}>{children}</Drafts.Provider>
    </Receipts.Provider>
  );
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
