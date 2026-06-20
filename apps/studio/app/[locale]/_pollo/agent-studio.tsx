"use client";

/**
 * Agent surface (chat-first homepage tab). The idea: the user talks to the
 * agent, it understands intent and routes them to the right module (generate an
 * image/video, open a project/canvas, run a tool…). This is the guided front
 * door. Here it's the entry UI — a chat composer + intent suggestions; the
 * actual intent-routing/orchestration is a backend follow-up. Themed via `theme`.
 */

import { useState } from "react";
import { IconArrowUp, IconPaperclip } from "@tabler/icons-react";
import { CONIC_BORDER, type Theme } from "./theme";
import { GradientRing } from "./glyphs";

// intent starters — each maps to a real module the agent would route into.
const SUGGESTIONS = [
  "Make a cinematic product ad",
  "Generate an image from a prompt",
  "Turn a script into a video",
  "Start a new project on the canvas",
  "Remove the background from a photo",
];

export function AgentStudio({ theme: t }: { theme: Theme }) {
  const [input, setInput] = useState("");
  const canSend = input.trim().length > 0;

  return (
    <div className="mx-auto mt-6 w-full max-w-[1200px]">
      <p className="mb-5 text-center text-[15px] text-white/55">
        Not sure where to start? Tell me your idea — I&apos;ll pick the right tools and set it up.
      </p>

      <div className="relative rounded-[24px]">
        <GradientRing padding="1.5px" gradient={CONIC_BORDER} />
        <div
          className="rounded-[24px] p-4 backdrop-blur-[60px] backdrop-saturate-150"
          style={{ background: t.panelBg }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe what you want to make, or ask how to get started…"
            rows={3}
            className="min-h-[80px] w-full resize-none bg-transparent pt-1 text-[15px] font-light leading-[22px] text-white/85 outline-none placeholder:text-white/35"
          />
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              aria-label="Attach"
              className="grid size-9 place-items-center rounded-lg bg-white/[0.06] text-white/70 transition hover:bg-white/[0.1]"
            >
              <IconPaperclip className="size-[18px]" stroke={1.8} />
            </button>
            <button
              type="button"
              aria-label="Send"
              disabled={!canSend}
              className={[
                "grid size-9 place-items-center rounded-full transition",
                canSend
                  ? "hover:brightness-110"
                  : "cursor-not-allowed bg-white/[0.06] text-white/25",
              ].join(" ")}
              style={
                canSend
                  ? { background: t.genBg, color: t.genText, boxShadow: t.genShadow }
                  : undefined
              }
            >
              <IconArrowUp className="size-5" stroke={2} />
            </button>
          </div>
        </div>
      </div>

      {/* intent suggestions — fill the box for now; later they route to a module */}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setInput(s)}
            className="rounded-full bg-white/[0.06] px-3.5 py-2 text-[13px] text-white/70 transition hover:bg-white/[0.1] hover:text-white/90"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
