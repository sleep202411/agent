import { z } from "zod";
import {
  TextGameUpdateInputSchema,
  type TextGameDetail,
  type TextGameUpdateInput,
} from "@repo/shared/text-game";
import { durableRecord } from "@/lib/durable-record";
const saved = z.object({
  gameId: z.string(),
  version: z.string(),
  updatedAt: z.string(),
  patch: z.unknown(),
});
export function textAdventureDraft(userId: string, game: TextGameDetail) {
  const storage = durableRecord("text-adventure-draft", userId, game.gameId);
  return {
    read() {
      const raw = storage.read();
      if (raw === null || raw === "null") return null;
      const value = saved.parse(JSON.parse(raw));
      if (value.gameId !== game.gameId) throw new Error("Draft identity mismatch");
      return {
        ...value,
        patch: TextGameUpdateInputSchema.parse(value.patch),
        conflict: value.version !== game.draftVersionId || value.updatedAt !== game.updatedAt,
      };
    },
    write(patch: TextGameUpdateInput) {
      storage.write(
        JSON.stringify(
          saved.parse({
            gameId: game.gameId,
            version: game.draftVersionId,
            updatedAt: game.updatedAt,
            patch: TextGameUpdateInputSchema.parse(patch),
          })
        )
      );
    },
    clear() {
      storage.write("null");
    },
  };
}
