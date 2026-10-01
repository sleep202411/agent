import { z } from "zod";
import { clientRequestKey } from "@/lib/client-request-key";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { durableRecordKey } from "@/lib/durable-record-key";
import {
  createTextAdventure,
  getTextAdventure,
  listTextAdventures,
  type TextAdventureSession,
} from "./api/text-adventure-api";
import { pickAndUploadTextAdventureMedia } from "./text-adventure-upload";
import { withTextCreationLock } from "./text-adventure-create-lock";
const recordSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string(),
    url: z.string().url(),
    phase: z.enum(["ready", "creating", "created"]),
    gameId: z
      .string()
      .regex(/^tg_[A-Za-z0-9]{16}$/)
      .optional(),
  })
  .refine((r) => (r.phase === "created" ? !!r.gameId : r.gameId === undefined));
export type TextCreationRecord = z.infer<typeof recordSchema>;
export function textAdventureCreation(session: TextAdventureSession) {
  const storage = durableRecord("text-adventure-creation", session.userId, "new");
  const key = durableRecordKey("text-adventure-creation", session.userId, "new");
  const current = (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (session.generation !== getAuthGeneration())
      throw new Error("Text adventure creation account changed.");
  };
  const read = () => {
    current();
    const raw = storage.read();
    return raw === null || raw === "null" ? null : recordSchema.parse(JSON.parse(raw));
  };
  const write = (record: TextCreationRecord) => {
    current();
    storage.write(JSON.stringify(recordSchema.parse(record)));
    return record;
  };
  const requireRecord = (id: string) => {
    const record = read();
    if (!record || record.id !== id)
      throw new Error("The pending text adventure changed. Reload before continuing.");
    return record;
  };
  return {
    read,
    select: (signal: AbortSignal) =>
      withTextCreationLock(key, async () => {
        current(signal);
        if (read()) throw new Error("Finish or discard the current creation first.");
        const uploaded = await pickAndUploadTextAdventureMedia(
          "document",
          session.generation,
          signal
        );
        current(signal);
        if (!uploaded) return null;
        return write({
          id: clientRequestKey(),
          name: uploaded.name,
          url: uploaded.url,
          phase: "ready",
        });
      }),
    create: (id: string, signal: AbortSignal) =>
      withTextCreationLock(key, async () => {
        current(signal);
        const record = requireRecord(id);
        if (record.phase !== "ready")
          throw new Error("Check the existing creation result before submitting another request.");
        write({ ...record, phase: "creating" });
        const game = await createTextAdventure({ worldviewDocxUrl: record.url }, session, signal);
        current(signal);
        return write({ ...record, phase: "created", gameId: game.gameId });
      }),
    recover: (id: string, signal: AbortSignal) =>
      withTextCreationLock(key, async () => {
        current(signal);
        const record = requireRecord(id);
        if (record.phase !== "creating") return record;
        const rows = await listTextAdventures(session, signal);
        let found: string | undefined;
        for (const row of rows) {
          current(signal);
          const game = await getTextAdventure(row.gameId, session, signal);
          if (game.content.worldviewDocxUrl === record.url) {
            if (found)
              throw new Error(
                "Multiple works match this document. Review the library before starting another creation."
              );
            found = game.gameId;
          }
        }
        current(signal);
        return found ? write({ ...record, phase: "created", gameId: found }) : record;
      }),
    discard: (id: string, acknowledgeUnknown = false) =>
      withTextCreationLock(key, async () => {
        current();
        const record = requireRecord(id);
        if (record.phase === "creating" && !acknowledgeUnknown)
          throw new Error(
            "Creation may have completed. Check the library before discarding this record."
          );
        storage.write("null");
      }),
  };
}
