import { z } from "zod";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";

const entrySchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  session: z.string().min(1),
  gameId: z.string().min(1),
  chapterId: z.string(),
});
export type StoryTopUpReturn = z.infer<typeof entrySchema>;
const launchSession = `${Date.now()}-${Math.random()}`;
let sequence = 0;

/** A destination only: never proof of payment or permission to retry a purchase. */
export function createStoryTopUpReturnStore(storage: DurableRecord, session: string) {
  const read = (): StoryTopUpReturn | null => {
    const raw = storage.read();
    return raw === null ? null : entrySchema.nullable().parse(JSON.parse(raw));
  };
  const clear = (id: string) => {
    if (read()?.id === id) storage.write("null");
  };
  return {
    remember(gameId: string, chapterId = "") {
      const entry = entrySchema.parse({
        version: 1,
        id: `${session}:${++sequence}`,
        session,
        gameId,
        chapterId,
      });
      storage.write(JSON.stringify(entry));
      return entry;
    },
    interrupted() {
      const entry = read();
      return entry?.session !== session ? entry : null;
    },
    clear,
    arrived(gameId: string, chapterId = "") {
      const entry = read();
      if (entry?.gameId === gameId && entry.chapterId === chapterId) clear(entry.id);
    },
    matches(id: string) {
      return read()?.id === id;
    },
  };
}

export function storyTopUpReturnStore(accountId: string) {
  return createStoryTopUpReturnStore(
    durableRecord("story-top-up-return", accountId, "destination"),
    launchSession
  );
}

export function storyTopUpReturnPath(entry: StoryTopUpReturn): string {
  const path = `/play/interactive-film/${encodeURIComponent(entry.gameId)}`;
  return entry.chapterId ? `${path}?chapter=${encodeURIComponent(entry.chapterId)}` : path;
}
