import {
  ExperienceJourneyDeltaSchema,
  ExperienceJourneySchema,
} from "@repo/shared/experience-runtime";
import { z } from "zod/v4";

import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";

const revision = z.number().int().min(0).max(2_147_483_647);
const expectedRevision = revision.max(2_147_483_646);
const checkpoint = z.record(z.string(), z.unknown());
const saveSchema = z.object({
  gameId: z.string().min(1),
  chapterId: z.string().max(128),
  contentVersion: z.string().min(1).max(128),
  state: checkpoint,
  events: z.array(checkpoint).max(64),
  playback: checkpoint.nullish(),
  journey: ExperienceJourneySchema.nullish(),
  revision,
  updatedAt: z.string().datetime(),
});
const writeSchema = z
  .object({
    contentVersion: z.string().min(1).max(128),
    state: checkpoint,
    events: z.array(checkpoint).max(64),
    playback: checkpoint.nullish(),
    journeyDelta: ExperienceJourneyDeltaSchema.optional(),
    expectedRevision,
  })
  .strict();

export type StorySave = z.infer<typeof saveSchema>;
export type StorySaveWrite = z.infer<typeof writeSchema>;
export type StorySaveSlot = { save: StorySave | null; revision: number };

/** Bind a transport to one account generation; old players cannot write after login changes. */
export function createStorySavesApi() {
  const generation = getAuthGeneration();
  function current(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (generation !== getAuthGeneration())
      throw new DOMException("Save session changed.", "AbortError");
  }
  function path(gameId: string, suffix: string) {
    z.string().min(1).parse(gameId);
    return `/story-saves/${encodeURIComponent(gameId)}/${suffix}`;
  }
  function options(chapterId: string, signal?: AbortSignal) {
    z.string().max(128).parse(chapterId);
    return {
      service: "aurora" as const,
      retry: false,
      cache: "no-store" as const,
      signal,
      headers: { "Cache-Control": "no-store" },
      params: chapterId ? { chapterId } : {},
    };
  }
  function ownedSave(value: unknown, gameId: string, chapterId?: string): StorySave | null {
    if (value === null) return null;
    const save = saveSchema.parse(value);
    if (save.gameId !== gameId || (chapterId !== undefined && save.chapterId !== chapterId))
      throw new Error("Save belongs to another game or chapter.");
    return save;
  }
  return {
    async latest(gameId: string, signal?: AbortSignal): Promise<StorySave | null> {
      current(signal);
      const value = await api.get<unknown>(path(gameId, "latest"), options("", signal));
      current(signal);
      return ownedSave(value, gameId);
    },
    async read(gameId: string, chapterId = "", signal?: AbortSignal): Promise<StorySaveSlot> {
      current(signal);
      const value = await api.get<unknown>(path(gameId, "save"), options(chapterId, signal));
      current(signal);
      const slot = z.object({ save: saveSchema.nullable(), revision }).parse(value);
      const save = ownedSave(slot.save, gameId, chapterId);
      if (save && save.revision !== slot.revision)
        throw new Error("Save does not match its chapter revision.");
      return { save, revision: slot.revision };
    },
    async write(gameId: string, chapterId: string, input: StorySaveWrite, signal?: AbortSignal) {
      current(signal);
      const data = writeSchema.parse(input);
      const value = await api.put<unknown>(path(gameId, "save"), {
        ...options(chapterId, signal),
        data,
      });
      current(signal);
      const ack = z
        .object({ saved: z.literal(true), updatedAt: z.string().datetime(), revision })
        .parse(value);
      if (ack.revision !== data.expectedRevision + 1)
        throw new Error("Invalid save acknowledgement revision.");
      return ack;
    },
    async clear(gameId: string, chapterId: string, previousRevision: number, signal?: AbortSignal) {
      current(signal);
      const expected = expectedRevision.parse(previousRevision);
      const config = options(chapterId, signal);
      const value = await api.delete<unknown>(path(gameId, "save"), {
        ...config,
        params: { ...config.params, expectedRevision: expected },
      });
      current(signal);
      const ack = z.object({ cleared: z.literal(true), revision }).parse(value);
      if (ack.revision !== expected + 1) throw new Error("Invalid save acknowledgement revision.");
      return ack;
    },
  };
}
