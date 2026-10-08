"use client";
import { useId } from "react";
import type { ExperiencePauseUIProps } from "./experience-ui";

/** A view-only implementation of the player's Pause slot. Actions stay with the runtime. */
export function ExperienceThemedPauseUI({
  resumeRef,
  reason,
  copy,
  restartLabel,
  onResume,
  onRestart,
}: ExperiencePauseUIProps) {
  const titleId = useId();
  const hintId = useId();
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      aria-describedby={reason === "refused" ? hintId : undefined}
      data-ui-part="panel"
      className="flex max-h-full w-full max-w-sm flex-col items-center overflow-y-auto rounded-2xl bg-black/70 p-6 text-center text-white"
    >
      <h2 id={titleId} data-ui-part="title" className="text-xl font-semibold">
        {copy.paused}
      </h2>
      {reason === "refused" && (
        <p id={hintId} data-ui-part="summary" className="mt-3 text-sm text-white/70">
          {copy.interrupted}
        </p>
      )}
      <button
        ref={resumeRef}
        type="button"
        data-ui-part="primary"
        data-experience-paused-frame={reason}
        className="mt-5 min-h-11 w-full shrink-0 rounded-xl bg-white px-5 py-3 font-semibold text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        onClick={onResume}
      >
        {reason === "refused" ? copy.continuePlaying : copy.resume}
      </button>
      <button
        type="button"
        data-ui-part="secondary"
        className="mt-3 min-h-11 w-full shrink-0 rounded-xl bg-white/10 px-5 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        onClick={onRestart}
      >
        {restartLabel}
      </button>
    </div>
  );
}
