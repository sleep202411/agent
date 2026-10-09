import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { ExperienceAppearance } from "@repo/shared/experience-runtime";
import {
  DEFAULT_APPEARANCE,
  decodeAppearanceWorkspace,
  encodeAppearanceWorkspace,
  type Workspace,
} from "./appearance-workspace-storage";
export { DEFAULT_APPEARANCE } from "./appearance-workspace-storage";
export type { Workspace } from "./appearance-workspace-storage";
export type Appearance = ExperienceAppearance;
const STORAGE_KEY = "fizzdragon.appearance-ux.v1";

function createWorkspaceStore(key: string, initial: Workspace) {
  const store = createStore(() => ({
    workspace: initial,
    restoreError: "",
    persistenceFailed: false,
  }));
  let hydrated = false;
  let volatile = false;
  let users = 0;
  const hydrate = (raw: string | null) => {
    if (!raw) return;
    try {
      store.setState({
        workspace: decodeAppearanceWorkspace(raw),
        restoreError: "",
        persistenceFailed: false,
      });
      volatile = false;
    } catch (reason) {
      store.setState({ restoreError: reason instanceof Error ? reason.message : String(reason) });
    }
  };
  const record = {
    store,
    attach() {
      users++;
      stores.set(key, record);
      if (!hydrated) {
        hydrated = true;
        try {
          hydrate(localStorage.getItem(key));
        } catch (reason) {
          store.setState({ restoreError: String(reason) });
        }
      }
      const onStorage = (event: StorageEvent) => {
        // Keep quota-failed edits when another window writes the same project.
        if (event.key === key && !volatile) hydrate(event.newValue);
      };
      const beforeUnload = (event: BeforeUnloadEvent) => {
        if (!volatile) return;
        event.preventDefault();
        event.returnValue = "";
      };
      window.addEventListener("storage", onStorage);
      window.addEventListener("beforeunload", beforeUnload);
      return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener("beforeunload", beforeUnload);
        if (
          --users === 0 &&
          !volatile &&
          !store.getState().restoreError &&
          stores.get(key)?.store === store
        )
          stores.delete(key);
      };
    },
    update(change: (current: Workspace) => Workspace): boolean {
      const next = change(store.getState().workspace);
      store.setState({ workspace: next });
      volatile = true;
      // A malformed saved draft remains recoverable; never overwrite it automatically.
      if (store.getState().restoreError) return false;
      try {
        const compact = encodeAppearanceWorkspace(next);
        store.setState({ workspace: compact.workspace });
        localStorage.setItem(key, compact.raw);
        volatile = false;
        store.setState({ persistenceFailed: false });
        return true;
      } catch {
        store.setState({ persistenceFailed: true });
        return false;
      }
    },
  };
  return record;
}
const stores = new Map<string, ReturnType<typeof createWorkspaceStore>>();

/** Project-local drafts. Quota failures preserve memory edits and existing disk data. */
export function useAppearanceWorkspace(
  projectId?: string,
  initial?: { appearance: Appearance | null; projectVersion: number }
) {
  const key = projectId ? `${STORAGE_KEY}:${encodeURIComponent(projectId)}` : STORAGE_KEY;
  const record = useMemo(() => {
    const fresh = () =>
      createWorkspaceStore(key, {
        applied: initial?.appearance ?? DEFAULT_APPEARANCE,
        baseProjectVersion: initial?.projectVersion,
        prompt: "",
        undo: [],
      });
    if (typeof window === "undefined") return fresh();
    const current = stores.get(key) ?? fresh();
    stores.set(key, current);
    return current;
    // Saved project refreshes must not replace an editable draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const state = useStore(record.store);
  useEffect(() => record.attach(), [record]);
  return { ...state, update: record.update };
}
