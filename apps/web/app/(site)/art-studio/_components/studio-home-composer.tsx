"use client";

import { useLayoutEffect, useRef, useState, type ComponentType, type SVGProps } from "react";
import { useRouter } from "next/navigation";
import {
  IconArrowUp,
  IconBuildingStore,
  IconLayoutList,
  IconLoader2,
  IconMask,
  IconPaperclip,
  IconSparkles,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { localizePath, getCurrentLocale } from "@/src/i18n/locale-url";
import { cn } from "@/lib/utils";
import { uploadWorkspaceFile } from "@/src/lib/uploads/workspace-upload";
import { quickCreateWorldProduct } from "@/src/services/world";
import {
  STUDIO_SEED_STORAGE_KEY,
  type StudioAgent,
  type StudioSeed,
  type StudioSeedAttachment,
} from "@/src/types/studio-seed";

const ACCEPTED_EXTENSIONS = [".txt", ".md", ".text", ".docx", ".pdf"];
const MAX_SCRIPT_SIZE = 50 * 1024 * 1024; // 50MB

function isSupportedScript(file: File) {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Pin which crew role handles the first agent message after this composer
 * lands the user in the workspace chat. Same intent as the in-chat
 * `ForcePersonaPills` — but this composer feeds `seed.agent`, which the
 * workspace consumer reads via `mapSeedAgent` and dispatches to
 * `setAgentType`. Pills are hidden when a script file is attached: that
 * path bypasses chat entirely and lands in the /produce wizard, where the
 * pill choice would be silently dropped.
 *
 * Tones / icons mirror `ASSISTANT_PERSONAS` so the entry composer reads
 * as the same crew the user will meet inside the project.
 */
const STUDIO_AGENT_PILLS: {
  agent: StudioAgent;
  labelKey: string;
  icon: IconType;
  /** Tailwind classes applied to the pill itself when active. Matches
   *  PERSONA_TONE_CLASSES in `apps/web/src/lib/assistant/personas.ts`. */
  active: string;
  /** Ring + glow applied to the composer card when this pill is pinned —
   *  parallel to PERSONA_TONE_RING in the in-chat composer, which switches
   *  the card border to the persona's tone the moment a pill is clicked.
   *  Without this the pill click feels like a no-op. */
  composerRing: string;
  /** Text-tone class for the inline `角色设计师 /` prefix rendered at the
   *  start of the typing area — matches PERSONA_TONE_TEXT, kept inline
   *  here so the pill row drives every visual signal from one record. */
  prefixTone: string;
  /** Localized placeholder text — i18n key under `ai.personas.*` — so the
   *  textarea hints which crew the user has pinned. */
  personaKey: string;
}[] = [
  {
    agent: "episode",
    labelKey: "forcePersonaEpisodePlanner",
    icon: IconLayoutList,
    active: "bg-lime-500/10 text-lime-300 border-lime-400/30",
    composerRing: "ring-lime-400/60 shadow-[0_0_32px_-8px_rgb(132_204_22/0.55)]",
    prefixTone: "text-lime-300",
    personaKey: "personas.episodePlanner",
  },
  {
    agent: "character",
    labelKey: "forcePersonaCharacter",
    icon: IconUsers,
    active: "bg-amber-500/10 text-amber-300 border-amber-400/30",
    composerRing: "ring-amber-400/60 shadow-[0_0_32px_-8px_rgb(245_158_11/0.55)]",
    prefixTone: "text-amber-300",
    personaKey: "personas.characterDesigner",
  },
  {
    agent: "scene",
    labelKey: "forcePersonaScene",
    icon: IconBuildingStore,
    active: "bg-teal-500/10 text-teal-300 border-teal-400/30",
    composerRing: "ring-teal-400/60 shadow-[0_0_32px_-8px_rgb(20_184_166/0.55)]",
    prefixTone: "text-teal-300",
    personaKey: "personas.sceneDesigner",
  },
  {
    agent: "prop",
    labelKey: "forcePersonaProp",
    icon: IconMask,
    active: "bg-orange-500/10 text-orange-300 border-orange-400/30",
    composerRing: "ring-orange-400/60 shadow-[0_0_32px_-8px_rgb(249_115_22/0.55)]",
    prefixTone: "text-orange-300",
    personaKey: "personas.propDesigner",
  },
];

export function StudioHomeComposer() {
  const t = useTranslations("workspace");
  const tp = useTranslations("project");
  const tc = useTranslations("common");
  const ta = useTranslations("ai");
  const router = useRouter();

  const [prompt, setPrompt] = useState("");
  // null = no pill pinned; submit defaults to "character" so the seed
  // payload stays a valid StudioAgent for downstream consumers.
  const [agent, setAgent] = useState<StudioAgent | null>(null);
  const [focused, setFocused] = useState(false);
  const [scriptFile, setScriptFile] = useState<File | null>(null);
  const [scriptAttachment, setScriptAttachment] = useState<StudioSeedAttachment | null>(null);
  const [scriptUploading, setScriptUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const personaPrefixRef = useRef<HTMLSpanElement>(null);

  const canSubmit =
    !submitting && !scriptUploading && (prompt.trim().length > 0 || scriptAttachment !== null);

  const pinnedPill = agent ? (STUDIO_AGENT_PILLS.find((p) => p.agent === agent) ?? null) : null;

  // Width of the inline `{personaName} / ` prefix span. Used as the
  // textarea's first-line text-indent so the user's typing flows AFTER
  // the colored prefix instead of overlapping it. We measure on every
  // pinned-pill change because the persona name length differs by role
  // and locale (e.g. "Character Designer / " vs "角色设计师 / ").
  const [prefixWidth, setPrefixWidth] = useState(0);
  useLayoutEffect(() => {
    if (!pinnedPill) {
      setPrefixWidth(0);
      return;
    }
    const node = personaPrefixRef.current;
    if (!node) return;
    setPrefixWidth(Math.ceil(node.getBoundingClientRect().width));
  }, [pinnedPill, ta]);

  // ─── Script upload ────────────────────────────────────

  const handleScriptPick = () => fileInputRef.current?.click();

  const handleScriptChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    if (!isSupportedScript(file)) {
      toast.warning(tc("unsupportedFileType"));
      return;
    }
    if (file.size > MAX_SCRIPT_SIZE) {
      toast.warning(tc("fileSizeExceedMb", { size: Math.round(MAX_SCRIPT_SIZE / 1024 / 1024) }));
      return;
    }

    setScriptFile(file);
    setScriptAttachment(null);
    setScriptUploading(true);
    try {
      const uploaded = await uploadWorkspaceFile(file, {
        uploadType: "WORLD",
        sourceType: "LOCAL",
        maxSize: MAX_SCRIPT_SIZE,
      });
      setScriptAttachment({
        path: uploaded.path,
        url: uploaded.url ?? "",
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      });
    } catch (err) {
      console.warn("[StudioHomeComposer] script upload failed", err);
      toast.error(tc("uploadFailed"));
      setScriptFile(null);
    } finally {
      setScriptUploading(false);
    }
  };

  const handleScriptRemove = () => {
    setScriptFile(null);
    setScriptAttachment(null);
  };

  // ─── Submit ───────────────────────────────────────────

  const handleSubmit = async () => {
    if (!canSubmit) return;
    console.info("[studio-composer] submit", {
      agent,
      hasPrompt: !!prompt.trim(),
      hasScript: !!scriptAttachment,
    });
    setSubmitting(true);
    try {
      const { worldId, projectId } = await quickCreateWorldProduct(tp("unnamedWorld"));
      console.info("[studio-composer] quick-create ok", { worldId, projectId });
      // Stash the composer payload in sessionStorage so the project
      // workspace can pick it up on mount and bootstrap the first turn.
      // Was a postMessage round-trip when the studio lived inside an
      // iframe; now that everything is same-origin Next.js, the storage
      // hop is enough.
      const seed: StudioSeed = {
        // Pin pill choice; fall back to "character" so the seed shape
        // stays valid when no pill is selected (matches old default).
        agent: agent ?? "character",
        prompt: prompt.trim(),
        attachment: scriptAttachment ?? undefined,
      };
      try {
        sessionStorage.setItem(
          STUDIO_SEED_STORAGE_KEY,
          JSON.stringify({ projectId, worldId, seed })
        );
      } catch (err) {
        console.warn("[studio-composer] sessionStorage write failed", err);
      }
      router.push(localizePath(`/projects/${projectId}`, getCurrentLocale()));
    } catch (err) {
      console.warn("[studio-composer] quick-create failed", err);
      toast.error(tc("uploadFailed"));
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6">
      {/* Headline */}
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          {t("studioHomeTitle")}
        </h1>
        <p className="text-sm text-muted-foreground sm:text-base">{t("studioHomeSubtitle")}</p>
      </div>

      {/* Composer — liquid glass over the hero video. When a persona pill
          is pinned, the outer ring + glow takes on that crew member's tone
          — same affordance as the in-chat composer, so the click reads as
          "you're now talking to this designer" rather than just toggling
          a button. Pinned tone overrides both focused and idle states. */}
      <div className="relative w-full">
        <div
          className={cn(
            "rounded-3xl bg-white/5 backdrop-blur-2xl backdrop-saturate-150 transition-all duration-500",
            "ring-1 ring-inset",
            pinnedPill
              ? pinnedPill.composerRing
              : focused
                ? "ring-primary/60 shadow-[0_0_32px_-8px_oklch(0.591_0.225_26.8/0.45)]"
                : "ring-white/15 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.5)]"
          )}
        >
          {/* Inline persona prefix — same visual the in-chat composer
              renders via the `personaPrefix` Tiptap node: plain colored
              text "{personaName} / " sitting at offset 0 of the typing
              area. We can't do an inline atom in a plain textarea, so we
              fake it with an absolutely-positioned span and a measured
              first-line `text-indent` on the textarea. The user's text
              flows AFTER the prefix, wraps to the left edge on subsequent
              lines (text-indent only affects the first line — exactly
              what the in-chat editor does too). Removed by toggling the
              pill again or clicking ×; the pill drives the text-indent
              so deletion stays in lockstep with the pin. */}
          <div className="relative">
            {pinnedPill && (
              <span
                ref={personaPrefixRef}
                aria-hidden
                className={cn(
                  "pointer-events-none absolute left-5 top-5 select-none text-[15px] leading-relaxed font-medium",
                  pinnedPill.prefixTone
                )}
              >
                {ta(pinnedPill.personaKey)}
                <span className="opacity-70"> / </span>
              </span>
            )}

            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={pinnedPill ? "" : t("studioHomePlaceholder")}
              rows={3}
              style={pinnedPill ? { textIndent: `${prefixWidth}px` } : undefined}
              className="min-h-35 w-full resize-none bg-transparent px-5 pt-5 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
              disabled={submitting}
            />
          </div>

          {/* Attached script chip */}
          {(scriptFile || scriptAttachment) && (
            <div className="flex items-center gap-2 px-4 pb-1">
              <div className="flex items-center gap-2 rounded-full border border-border/70 bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
                {scriptUploading ? (
                  <IconLoader2 className="size-3.5 shrink-0 animate-spin" />
                ) : (
                  <IconPaperclip className="size-3.5 shrink-0" />
                )}
                <span className="max-w-60 truncate">
                  {scriptFile?.name ?? scriptAttachment?.name}
                </span>
                <button
                  type="button"
                  onClick={handleScriptRemove}
                  className="flex size-4 items-center justify-center rounded-full hover:bg-muted hover:text-foreground"
                  aria-label={tc("delete") ?? "Remove"}
                >
                  <IconX className="size-3" />
                </button>
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-2 px-3 pb-3">
            <div className="flex items-center gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_EXTENSIONS.join(",")}
                className="hidden"
                onChange={handleScriptChange}
              />
              <ToolbarPill
                icon={<IconPaperclip className="size-3.5" />}
                onClick={handleScriptPick}
                disabled={scriptUploading || submitting}
              >
                {t("studioHomeScript")}
              </ToolbarPill>
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              aria-label={t("studioHomeSend")}
              className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_18px_-2px_oklch(0.591_0.225_26.8/0.5)] transition-all hover:bg-primary-hover disabled:opacity-40 disabled:shadow-none"
            >
              {submitting ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconArrowUp className="size-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Persona pin pills — sibling of the composer card so the row
          reads as a "what crew lead should I start with?" picker rather
          than another in-composer toolbar control. Hidden once a script
          file is attached: that path bypasses chat and lands in the
          /produce wizard, where the pill choice would be silently
          dropped. */}
      {!scriptFile && !scriptAttachment && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-center gap-2",
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          )}
        >
          {STUDIO_AGENT_PILLS.map(({ agent: key, labelKey, icon: Icon, active }) => {
            const isActive = agent === key;
            return (
              <button
                key={key}
                type="button"
                disabled={submitting}
                onClick={() => setAgent(isActive ? null : key)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border backdrop-blur-md transition-all",
                  "px-4 py-2 text-sm",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  isActive
                    ? cn(active, "shadow-lg")
                    : "border-white/15 bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                )}
              >
                <IconSparkles className="size-3.5" />
                <Icon className="size-3.5" />
                {ta(labelKey)}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ToolbarPill({
  children,
  icon,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 items-center gap-1.5 rounded-full border border-border/70 px-3 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon}
      {children}
    </button>
  );
}
