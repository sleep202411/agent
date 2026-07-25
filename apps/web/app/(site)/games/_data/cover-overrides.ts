/**
 * Temporary local covers for published games whose Java catalogue row has no
 * `coverUrl` yet.
 *
 * A gap here is not cosmetic: a card with no cover renders as an empty grey
 * tile, so the catalogue looks broken rather than sparse. Until covers can be
 * set on the game itself, they are pinned by game id.
 *
 * The override only fills a gap — a real `coverUrl` from the backend always
 * wins, so removing an entry here is the whole cleanup once the row is fixed.
 */
export const GAME_COVER_OVERRIDES: Readonly<Record<string, string>> = {
  // 卡夫卡的AI漂流记
  "019f6f94-fe69-7efb-8fa9-e9a71842d884": "/games-covers/kafka-ai-drift.jpg",
};

export function resolveGameCover(gameId: string, coverUrl: string | null | undefined) {
  return coverUrl ?? GAME_COVER_OVERRIDES[gameId] ?? null;
}
