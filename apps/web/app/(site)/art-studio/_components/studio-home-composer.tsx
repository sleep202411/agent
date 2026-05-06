"use client";

import { useRef, useState, type ComponentType, type SVGProps } from "react";
import { useRouter } from "next/navigation";
import {
  IconArrowUp,
  IconBuildingStore,
  IconLayoutList,
  IconLoader2,
  IconMask,
  IconPaperclip,
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
  /** Tailwind classes applied when the pill is active. Matches
   *  PERSONA_TONE_CLASSES in `apps/web/src/lib/assistant/personas.ts`. */
  active: string;
}[] = [
  {
    agent: "episode",
    labelKey: "forcePersonaEpisodePlanner",
    icon: IconLayoutList,
    active: "bg-lime-500/10 text-lime-300 border-lime-400/30",
  },
  {
    agent: "character",
    labelKey: "forcePersonaCharacter",
    icon: IconUsers,
    active: "bg-amber-500/10 text-amber-300 border-amber-400/30",
  },
  {
    agent: "scene",
    labelKey: "forcePersonaScene",
    icon: IconBuildingStore,
    active: "bg-teal-500/10 text-teal-300 border-teal-400/30",
  },
  {
    agent: "prop",
    labelKey: "forcePersonaProp",
    icon: IconMask,
    active: "bg-orange-500/10 text-orange-300 border-orange-400/30",
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

  const canSubmit =
    !submitting && !scriptUploading && (prompt.trim().length > 0 || scriptAttachment !== null);

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

      {/* Composer — liquid glass over the hero video */}
      <div className="relative w-full">
        <div
          className={cn(
            "rounded-3xl bg-white/5 backdrop-blur-2xl backdrop-saturate-150 transition-all duration-500",
            "ring-1 ring-inset",
            focused
              ? "ring-primary/60 shadow-[0_0_32px_-8px_oklch(0.591_0.225_26.8/0.45)]"
              : "ring-white/15 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.5)]"
          )}
        >
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
            placeholder={t("studioHomePlaceholder")}
            rows={3}
            className="min-h-[140px] w-full resize-none bg-transparent px-5 pt-5 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
            disabled={submitting}
          />

          {/* Attached script chip */}
          {(scriptFile || scriptAttachment) && (
            <div className="flex items-center gap-2 px-4 pb-1">
              <div className="flex items-center gap-2 rounded-full border border-border/70 bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
                {scriptUploading ? (
                  <IconLoader2 className="size-3.5 shrink-0 animate-spin" />
                ) : (
                  <IconPaperclip className="size-3.5 shrink-0" />
                )}
                <span className="max-w-[240px] truncate">
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

          {/* Persona pin pills — only meaningful for the freeform-chat
              path. With a file attached, submit goes to /produce instead
              and the pill choice would be silently ignored, so we hide
              the row to make the two paths visually distinct. */}
          {!scriptFile && !scriptAttachment && (
            <div
              className={cn(
                "flex items-center gap-1.5 overflow-x-auto px-4 pb-2",
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
                      "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                      "disabled:cursor-not-allowed disabled:opacity-50",
                      isActive
                        ? active
                        : "border-white/15 bg-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground"
                    )}
                  >
                    <Icon className="size-3" />
                    {ta(labelKey)}
                  </button>
                );
              })}
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
