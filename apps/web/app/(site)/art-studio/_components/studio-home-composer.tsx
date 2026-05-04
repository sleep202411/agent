"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconArrowUp, IconLoader2, IconPaperclip, IconSparkles, IconX } from "@tabler/icons-react";
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

export function StudioHomeComposer() {
  const t = useTranslations("workspace");
  const tp = useTranslations("project");
  const tc = useTranslations("common");
  const router = useRouter();

  const [prompt, setPrompt] = useState("");
  // Agent pills UI removed — keep a default in seed payload so
  // downstream consumers that still read `seed.agent` get a valid value.
  const agent: StudioAgent = "character";
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
        agent,
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
