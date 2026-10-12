"use client";

import { useEffect, useRef, useState, type SetStateAction } from "react";
import { z } from "zod";
import type { Draft } from "./task-creation-workbench";
import type { WorkbenchTaskBatch } from "./workbench-task-batch";

type Batch = WorkbenchTaskBatch & { created?: boolean; attempted?: boolean; requestId?: string };
type Snapshot = { drafts: Draft[]; batches: Batch[] };
const empty = (): Snapshot => ({ drafts: [], batches: [] });
const savedSchema = z.object({
  version: z.literal(1),
  drafts: z.array(
    z.object({
      id: z.number().int().nonnegative(),
      state: z.enum(["staged", "creating", "created", "uncertain", "submitted"]),
      taskId: z.string().optional(),
      requestId: z.string().optional(),
      input: z
        .object({
          title: z.string(),
          description: z.string(),
          priority: z.enum(["urgent", "high", "normal", "low"]),
          assignees: z.array(
            z.object({ userId: z.string(), currency: z.enum(["CNY", "USD"]) }).passthrough()
          ),
        })
        .passthrough(),
    })
  ),
  batches: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      path: z.string(),
      body: z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.array(
            z
              .object({
                templateKey: z.string(),
                values: z.array(
                  z
                    .object({
                      fieldId: z.string(),
                      value: z.union([
                        z.string(),
                        z.number(),
                        z.boolean(),
                        z.array(z.string()),
                        z.null(),
                      ]),
                    })
                    .strict()
                ),
              })
              .strict()
          ),
        ])
      ),
      items: z.array(
        z.object({
          title: z.string(),
          role: z.string().optional(),
          assetCategory: z.string().optional(),
        })
      ),
      created: z.boolean().optional(),
      requestId: z.string().optional(),
      attempted: z.boolean().optional(),
    })
  ),
});

/** Account + Crew scope prevents another account or Crew from receiving these drafts.
 * Write synchronously before navigation/request; effects alone can lose the last edit.
 * An interrupted non-idempotent creation is never restored as a retryable draft. */
export function useWorkbenchDrafts(userId: string, crewId: string) {
  const key = `fizz:workbench:v1:${encodeURIComponent(userId)}:${encodeURIComponent(crewId)}`;
  const current = useRef<Snapshot>(empty());
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);
  const [storageError, setStorageError] = useState(false);
  const loaded = useRef(false);
  const unreadable = useRef(false);
  useEffect(() => {
    function restore() {
      try {
        const raw = window.localStorage.getItem(key);
        const value = raw ? savedSchema.parse(JSON.parse(raw)) : { version: 1, ...empty() };
        const prefix = `/crews/${encodeURIComponent(crewId)}/`;
        // Persisted commands can only target the two reviewed batch APIs in this Crew.
        if (
          value.batches.some(
            (batch) =>
              !batch.path.startsWith(prefix) ||
              !/^(episodes\/[^/]+\/task-template|canvas-task-import\/story-projects\/[^/]+\/apply)$/.test(
                batch.path.slice(prefix.length)
              )
          )
        ) {
          throw new Error("Invalid saved batch");
        }
        const next: Snapshot = {
          drafts: value.drafts.map((draft) => ({
            ...draft,
            state: draft.state === "creating" ? "uncertain" : draft.state,
          })) as Draft[],
          batches: value.batches,
        };
        unreadable.current = false;
        current.current = next;
        setSnapshot(next);
        setStorageError(false);
      } catch {
        unreadable.current = true;
        // Do not erase an unreadable snapshot. The user can still finish in this tab.
        setStorageError(true);
      }
      loaded.current = true;
    }
    restore();
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) restore();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key, crewId]);

  function update<K extends keyof Snapshot>(field: K, action: SetStateAction<Snapshot[K]>) {
    if (!loaded.current) return false;
    const next = {
      ...current.current,
      [field]: typeof action === "function" ? action(current.current[field]) : action,
    };
    current.current = next;
    let saved = false;
    try {
      if (unreadable.current) throw new Error("Unreadable saved drafts");
      window.localStorage.setItem(key, JSON.stringify({ version: 1, ...next }));
      setStorageError(false);
      saved = true;
    } catch {
      setStorageError(true);
    }
    setSnapshot(next);
    return saved;
  }
  return {
    ...snapshot,
    storageError,
    setDrafts: (action: SetStateAction<Draft[]>) => update("drafts", action),
    setBatches: (action: SetStateAction<Batch[]>) => update("batches", action),
  };
}
