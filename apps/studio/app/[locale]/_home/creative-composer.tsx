"use client";

/**
 * The home's Creative composer — deliberately MINIMAL (imagine-style): a prompt
 * box with a bottom-left Image/Video toggle and a bottom-right submit. It does
 * NOT generate here; submit hands the prompt off to the full /images or /video
 * studio (via `?prompt=`), where the user picks model + params and generates.
 * Keeping model/settings/cost OFF the home keeps the entry frictionless.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { IconArrowUp, IconLayoutGrid, IconRefresh, type Icon } from "@tabler/icons-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAuth } from "@/app/_components/auth-provider";
import { GlassRim } from "@/components/ui/glass-rim";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { type Theme } from "../_pollo/theme";
import { G, Glyph } from "../_pollo/glyphs";

type Modality = "image" | "video" | "project";

const TOGGLE: { id: Modality; label: string; svg?: string; Icon?: Icon }[] = [
  { id: "image", label: "Image", svg: G.image },
  { id: "video", label: "Video", svg: G.video },
  { id: "project", label: "Project", Icon: IconLayoutGrid },
];

const PLACEHOLDER_EXAMPLES = [
  "Design a logo",
  "Make a 5-slide product carousel for Instagram",
  "Create a UGC-style ad video",
  "Turn a product photo into a campaign",
];

const SUGGESTION_GROUPS: Array<Array<{ label: string; prompt: string; modality: Modality }>> = [
  [
    {
      label: "On-brand social carousel",
      prompt:
        "Make a 5-slide Instagram carousel for a skincare product launch with a clean, modern look.",
      modality: "image",
    },
    {
      label: "Product mockup for Etsy",
      prompt:
        "Create a polished Etsy product mockup with warm daylight, a clean lifestyle backdrop, and space for listing copy.",
      modality: "image",
    },
    {
      label: "UGC-style ad video",
      prompt:
        "Create a UGC-style ad video for a new wellness product with natural handheld energy, quick cuts, captions, and a clear call to action.",
      modality: "video",
    },
  ],
  [
    {
      label: "Faceless YouTube short",
      prompt:
        "Create a faceless YouTube short with fast visual pacing, bold scene changes, and a concise educational hook.",
      modality: "video",
    },
    {
      label: "AI music video",
      prompt:
        "Create an AI music video with expressive camera movement, rhythmic scene changes, and a bright cinematic visual style.",
      modality: "video",
    },
    {
      label: "Podcast cover art",
      prompt:
        "Design premium podcast cover art with a clean editorial composition, strong title-safe negative space, and modern lighting.",
      modality: "image",
    },
  ],
  [
    {
      label: "Brand kit from logo",
      prompt:
        "Design a complete brand kit from a minimal logo concept, including color palette, typography direction, social avatar, and launch visuals.",
      modality: "project",
    },
    {
      label: "Interior moodboard",
      prompt:
        "Create an interior design moodboard for a bright modern studio with natural materials, soft daylight, and refined editorial styling.",
      modality: "image",
    },
    {
      label: "Campaign storyboard",
      prompt:
        "Build a campaign storyboard for a 15-second product launch video with opening hook, lifestyle use case, product close-up, and final CTA.",
      modality: "project",
    },
  ],
];

type TypewriterPhase = "typing" | "deleting";

const FLOWING_RIM_STYLE = {
  "--composer-rim-angle": "0deg",
  background:
    "conic-gradient(from var(--composer-rim-angle), transparent 0deg, transparent 244deg, rgba(255,255,255,0.06) 272deg, rgba(255,255,255,0.58) 304deg, rgba(190,200,210,0.34) 322deg, rgba(255,255,255,0.16) 338deg, transparent 360deg)",
  padding: "1px",
  WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
  WebkitMaskComposite: "xor",
  maskComposite: "exclude",
} as CSSProperties;

export function CreativeComposer({ theme: t }: { theme: Theme }) {
  const router = useRouter();
  const { requireAuth } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [modality, setModality] = useState<Modality>("image");
  const [prompt, setPrompt] = useState("");
  const [isPromptFocused, setIsPromptFocused] = useState(false);
  const [suggestionGroup, setSuggestionGroup] = useState(0);
  const showTypedPlaceholder = !prompt && !isPromptFocused;
  const { text: typedPlaceholder, reducedMotion } = useTypewriterPlaceholder(
    PLACEHOLDER_EXAMPLES,
    showTypedPlaceholder
  );
  const canSubmit = prompt.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    const dest = modality === "image" ? "/images" : modality === "video" ? "/video" : "/canvas";
    const nextHref = `${dest}?prompt=${encodeURIComponent(prompt.trim())}`;
    requireAuth(() => router.push(nextHref));
  };

  const applySuggestion = (suggestion: (typeof SUGGESTION_GROUPS)[number][number]) => {
    setPrompt(suggestion.prompt);
    setModality(suggestion.modality);
    setIsPromptFocused(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div className="mx-auto w-full max-w-[768px]">
      <style>{`
        @property --composer-rim-angle {
          syntax: "<angle>";
          inherits: false;
          initial-value: 0deg;
        }

        @keyframes fizzComposerRimFlow {
          to {
            --composer-rim-angle: 360deg;
          }
        }

        @media (prefers-reduced-motion: no-preference) {
          .fizz-composer-flow-rim {
            animation: fizzComposerRimFlow 4.2s linear infinite;
          }
        }
      `}</style>
      <div
        className="group/composer relative overflow-hidden rounded-[24px] bg-[#171717]/90 p-3 backdrop-blur-xl backdrop-saturate-150 transition-colors"
        style={{
          boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.04), 0 18px 60px rgb(0 0 0 / 0.24), ${t.tabGlow}`,
        }}
      >
        <GlassRim gradient={t.tabRing} className="opacity-80" />
        <GlassRim className="opacity-55" />
        <span
          aria-hidden
          className="fizz-composer-flow-rim pointer-events-none absolute inset-0 rounded-[inherit] opacity-25 transition-opacity duration-300 group-hover/composer:opacity-80 group-focus-within/composer:opacity-90"
          style={FLOWING_RIM_STYLE}
        />
        <div className="group/prompt relative min-h-8">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onFocus={() => setIsPromptFocused(true)}
            onBlur={() => setIsPromptFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            aria-label="Prompt"
            placeholder=""
            rows={1}
            className="relative z-10 block max-h-48 min-h-8 w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-[14px] leading-5 font-normal tracking-[0.28px] text-white/90 caret-white/80 outline-none"
          />

          {showTypedPlaceholder && (
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 left-0 z-0 min-h-8 w-full overflow-hidden px-1 py-1 text-[14px] leading-5 font-normal tracking-[0.28px] whitespace-pre text-white/35 group-focus-within/prompt:hidden"
            >
              {typedPlaceholder}
              {!reducedMotion ? (
                <span className="ml-px inline-block h-[1.05em] w-px animate-pulse bg-white/35 align-middle" />
              ) : null}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <ToggleGroup
            type="single"
            value={modality}
            onValueChange={(value) => {
              if (value === "image" || value === "video" || value === "project") {
                setModality(value);
              }
            }}
            aria-label="Generation type"
            spacing={0.5}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-xl bg-white/[0.03] p-0.5"
          >
            {TOGGLE.map((m) => {
              const active = modality === m.id;
              return (
                <ToggleGroupItem
                  key={m.id}
                  value={m.id}
                  aria-label={m.label}
                  className={cn(
                    "h-7 min-w-0 gap-1.5 rounded-[9px] px-2.5 text-[13px] font-medium transition-colors hover:bg-transparent hover:text-white/80 focus-visible:ring-1 focus-visible:ring-white/20",
                    "data-[state=on]:bg-white/[0.10] data-[state=on]:text-white",
                    active ? "text-white" : "text-white/55"
                  )}
                >
                  {m.svg ? (
                    <Glyph
                      svg={m.svg}
                      size={15}
                      fill={active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.5)"}
                    />
                  ) : m.Icon ? (
                    <m.Icon className="size-[15px] shrink-0" stroke={1.8} />
                  ) : null}
                  {m.label}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            aria-label="Create"
            className={cn(
              "grid size-7 place-items-center rounded-full transition",
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
            <IconArrowUp className="size-4" stroke={2.2} />
          </button>
        </div>
      </div>

      <div className="mt-6 flex w-full items-center justify-center gap-2.5">
        {SUGGESTION_GROUPS[suggestionGroup].map((suggestion) => (
          <button
            key={suggestion.label}
            type="button"
            onClick={() => applySuggestion(suggestion)}
            className="h-8 max-w-[220px] min-w-0 truncate rounded-xl bg-transparent px-2.5 py-1.5 text-[14px] leading-5 font-medium whitespace-nowrap text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.11)] transition duration-300 hover:bg-white/[0.07] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0)] active:translate-y-px"
          >
            {suggestion.label}
          </button>
        ))}
        <button
          type="button"
          aria-label="Shuffle suggestions"
          onClick={() => setSuggestionGroup((group) => (group + 1) % SUGGESTION_GROUPS.length)}
          className="grid size-8 shrink-0 place-items-center rounded-full bg-transparent text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.11)] transition duration-300 hover:bg-white/[0.07] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0)] active:translate-y-px"
        >
          <IconRefresh className="size-[18px]" stroke={1.8} />
        </button>
      </div>
    </div>
  );
}

function useTypewriterPlaceholder(examples: string[], active: boolean) {
  const [exampleIndex, setExampleIndex] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [phase, setPhase] = useState<TypewriterPhase>("typing");
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);

    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!active || reducedMotion || examples.length === 0) return;

    const fullText = examples[exampleIndex] ?? "";
    let delay = 52;

    if (phase === "typing") {
      if (charCount < fullText.length) {
        delay = 52;
      } else {
        delay = 1400;
      }
    } else {
      delay = 30;
    }

    const id = window.setTimeout(() => {
      if (phase === "typing") {
        if (charCount < fullText.length) {
          setCharCount((count) => count + 1);
        } else {
          setPhase("deleting");
        }
        return;
      }

      if (charCount > 0) {
        setCharCount((count) => Math.max(0, count - 1));
      } else {
        setExampleIndex((index) => (index + 1) % examples.length);
        setPhase("typing");
      }
    }, delay);

    return () => window.clearTimeout(id);
  }, [active, charCount, exampleIndex, examples, phase, reducedMotion]);

  if (reducedMotion) return { text: examples[0] ?? "", reducedMotion };

  return {
    text: (examples[exampleIndex] ?? "").slice(0, charCount),
    reducedMotion,
  };
}
