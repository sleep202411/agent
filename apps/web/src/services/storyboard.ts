/**
 * Storyboard service — thin transport-level wrappers around Java endpoints.
 *
 * Feature-private hooks should live next to the feature; this module is for
 * functions reused across multiple features (e.g. row reordering used by
 * both the table view and the card view).
 */

import { backendApi } from "@/src/lib/api";

/**
 * Reorder a single shot inside a storyboard. Semantic: place
 * `currentTheShotId` immediately *before* `beforeTheShotId`. Pass `null`
 * for `beforeTheShotId` to move the shot to the end.
 *
 * Mirrors fizzdragon-web's `updateShotOrder` so the Java endpoint stays
 * shared across both clients.
 */
export function updateShotOrder(
  storyBoardId: string,
  currentTheShotId: string,
  beforeTheShotId: string | null
) {
  return backendApi.post("/api/user/shot/updateSort", {
    data: {
      storyBoardId,
      currentTheShotId,
      beforeTheShotId,
    },
  });
}
