/**
 * Surfaces a toast every time a generation task transitions to `failed`.
 *
 * Why a Redux listener instead of inline `toast.error()` in each queue:
 *   - There are 5 task queues today (image / video / audio / fusion /
 *     lipsync) plus the server-poll thunk inside taskSlice. Each one
 *     dispatches `failTask` from its own catch block. A single listener
 *     here covers all of them, and any future queue automatically gets
 *     the toast without remembering to wire it.
 *   - Keeps the call sites focused on "do the work", not "tell the user
 *     about errors".
 *
 * The listener also reads the failed task's `type` field so we can pick
 * a task-kind-specific title ("Image generation failed" / "Video
 * generation failed" / …) instead of a generic message.
 */
import { createListenerMiddleware } from "@reduxjs/toolkit";
import { toast } from "sonner";

import i18n from "@/src/i18n/i18n";
import { extractFriendlyErrorMessage } from "@/src/lib/error-message";
import { failTask } from "./slices/taskSlice";

// Narrow shape of what the listener needs from store state — kept local
// so we don't import `RootState` and create a circular dep with the
// store module that mounts this middleware.
interface TaskStateView {
  task: {
    tasks: Record<string, { type?: string } | undefined>;
  };
}

function titleForType(type: string | undefined): string {
  switch (type) {
    case "image":
      return i18n.t("common.imageGenFailed", { defaultValue: "Image generation failed" });
    case "video":
      return i18n.t("common.videoGenFailed", { defaultValue: "Video generation failed" });
    case "audio":
      return i18n.t("common.audioGenFailed", { defaultValue: "Audio generation failed" });
    case "fusion":
      return i18n.t("common.fusionGenFailed", { defaultValue: "Fusion generation failed" });
    case "lipsync":
      return i18n.t("common.lipsyncGenFailed", { defaultValue: "Lip-sync generation failed" });
    default:
      return i18n.t("common.generateFailed", { defaultValue: "Generation failed" });
  }
}

export const taskFailureToastListener = createListenerMiddleware();

taskFailureToastListener.startListening({
  actionCreator: failTask,
  effect: (action, api) => {
    const state = api.getState() as TaskStateView;
    const task = state.task.tasks[action.payload.taskId];
    const title = titleForType(task?.type);
    // Prefer the parsed `data.message` from the upstream JSON envelope —
    // that's the human-readable part. Fall back to the raw payload when
    // the parser can't find a message (e.g. plain-text errors). Cap to
    // 800 chars so a 50 KB upstream blob doesn't blow up the toast.
    const raw = action.payload.error;
    const friendly = extractFriendlyErrorMessage(raw);
    const description = (friendly ?? raw).slice(0, 800);
    toast.error(title, {
      description,
      duration: 10000,
    });
  },
});
