"use client";

/**
 * The home's Creative composer — deliberately MINIMAL (imagine-style): a prompt
 * box with a bottom-left Image/Video toggle and a bottom-right submit. It does
 * NOT generate here; submit hands the prompt off to the full /images or /video
 * studio (via `?prompt=`), where the user picks model + params and generates.
 * Keeping model/settings/cost OFF the home keeps the entry frictionless.
 */

import { useState } from "react";
import { IconArrowUp } from "@tabler/icons-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { type Theme } from "../_pollo/theme";
import { G, Glyph } from "../_pollo/glyphs";

type Modality = "image" | "video";

const TOGGLE: { id: Modality; label: string; svg: string }[] = [
  { id: "image", label: "Image", svg: G.image },
  { id: "video", label: "Video", svg: G.video },
];

export function CreativeComposer({ theme: t }: { theme: Theme }) {
  const router = useRouter();
  const [modality, setModality] = useState<Modality>("image");
  const [prompt, setPrompt] = useState("");
  const canSubmit = prompt.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    const dest = modality === "image" ? "/images" : "/video";
    router.push(`${dest}?prompt=${encodeURIComponent(prompt.trim())}`);
  };

  return (
    <div className="mx-auto mt-8 w-full max-w-[760px] px-4">
      <div className="rounded-[24px] bg-[#171717] p-3 ring-1 ring-white/[0.06] transition-colors focus-within:ring-white/[0.12]">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Describe an idea to create…"
          rows={3}
          className="min-h-[84px] w-full resize-none bg-transparent px-2 pt-1.5 text-[15px] leading-[22px] font-light text-white/90 outline-none placeholder:text-white/35"
        />

        <div className="mt-2 flex items-center justify-between gap-3">
          {/* Image / Video segmented toggle — picks the create surface */}
          <div className="inline-flex shrink-0 items-center gap-0.5 rounded-xl bg-white/[0.03] p-0.5">
            {TOGGLE.map((m) => {
              const active = modality === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModality(m.id)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-[9px] px-2.5 text-[13px] font-medium transition-colors",
                    active ? "bg-white/[0.10] text-white" : "text-white/55 hover:text-white/80"
                  )}
                >
                  <Glyph
                    svg={m.svg}
                    size={15}
                    fill={active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.5)"}
                  />
                  {m.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            aria-label="Create"
            className={cn(
              "grid size-9 place-items-center rounded-full transition",
              canSubmit
                ? "hover:brightness-110"
                : "cursor-not-allowed bg-white/[0.06] text-white/25"
            )}
            style={
              canSubmit
                ? { background: t.genBg, color: t.genText, boxShadow: t.genShadow }
                : undefined
            }
          >
            <IconArrowUp className="size-[18px]" stroke={2.2} />
          </button>
        </div>
      </div>
    </div>
  );
}
