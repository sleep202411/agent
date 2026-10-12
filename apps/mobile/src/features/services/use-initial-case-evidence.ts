import { useEffect, useRef, useState } from "react";
import { uuid } from "expo-modules-core";
import { z } from "zod";
import { durableRecord } from "@/lib/durable-record";
import { getAuthGeneration } from "@/auth/auth-store";
import {
  pickCaseEvidence,
  uploadCaseEvidence,
  confirmCaseEvidence,
  type CaseUpload,
} from "./case-evidence-api";
const entry = z.object({ id: z.string().uuid(), name: z.string(), ready: z.boolean() });
const draft = z.object({ caseId: z.string().uuid(), items: z.array(entry).max(5) });
export function useInitialCaseEvidence(
  taskId: string,
  userId: string,
  generation: number,
  pendingId?: string
) {
  const [storage] = useState(() => durableRecord("task-case-initial-evidence", userId, taskId));
  const [initial] = useState(() => {
    try {
      const raw = storage.read();
      const value = raw
        ? draft.parse(JSON.parse(raw))
        : { caseId: pendingId ?? uuid.v4(), items: [] };
      if (pendingId && value.caseId !== pendingId)
        throw Error("Pending case evidence identity mismatch.");
      return { value, error: "" };
    } catch (cause) {
      return { value: { caseId: pendingId ?? uuid.v4(), items: [] }, error: String(cause) };
    }
  });
  const [value, setValue] = useState(initial.value),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initial.error);
  const controller = useRef<AbortController | null>(null),
    flight = useRef(false),
    uploads = useRef(new Map<string, CaseUpload>());
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    return () => {
      c.abort();
      controller.current = null;
    };
  }, []);
  const current = () =>
    !!controller.current &&
    !controller.current.signal.aborted &&
    getAuthGeneration() === generation;
  const save = (next: typeof value) => {
    if (!current()) throw Error("Evidence session expired.");
    storage.write(JSON.stringify(draft.parse(next)));
    setValue(next);
  };
  async function run(action: () => Promise<void>) {
    if (!current() || flight.current || initial.error) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      flight.current = false;
      if (current()) setBusy(false);
    }
  }
  async function finish(id: string, confirmOnly = false, next = value) {
    const c = controller.current!;
    const upload = uploads.current.get(id);
    if (confirmOnly || !upload)
      await confirmCaseEvidence(value.caseId, id, generation, c.signal, taskId);
    else await uploadCaseEvidence(value.caseId, upload, generation, c.signal, taskId);
    if (current())
      save({
        ...next,
        items: next.items.map((item) => (item.id === id ? { ...item, ready: true } : item)),
      });
  }
  return {
    caseId: value.caseId,
    items: value.items,
    busy,
    error,
    blocked: !!initial.error,
    unresolved: value.items.some((item) => !item.ready),
    ids: value.items.filter((item) => item.ready).map((item) => item.id),
    add: () =>
      run(async () => {
        if (value.items.length >= 5 || value.items.some((item) => !item.ready)) return;
        const upload = await pickCaseEvidence(generation, controller.current!.signal);
        if (!upload || !current()) return;
        const next = {
          ...value,
          items: [...value.items, { id: upload.id, name: upload.metadata.name, ready: false }],
        };
        save(next);
        uploads.current.set(upload.id, upload);
        await finish(upload.id, false, next);
      }),
    retry: (id: string, confirmOnly = false) => run(() => finish(id, confirmOnly)),
    remove: (id: string) => {
      if (!current() || flight.current || initial.error) return;
      try {
        save({ ...value, items: value.items.filter((item) => item.id !== id) });
        uploads.current.delete(id);
        setError("");
      } catch (cause) {
        setError(String(cause));
      }
    },
    clear: () => {
      if (!current()) throw Error("Evidence session expired.");
      storage.write("");
    },
  };
}
