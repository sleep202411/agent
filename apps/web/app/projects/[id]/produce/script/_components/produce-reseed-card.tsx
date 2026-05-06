"use client";

/**
 * In-page upload entry for re-running the produce pipeline against
 * fresh source material. Used in the "no seed / has project data"
 * branch of `produce/script/page.tsx` so users entering via the
 * 一键成片 header button (or refreshing the wizard) can supply a new
 * brief without bouncing back to the studio's New World dialog.
 *
 * Flow:
 *   1. Drop / pick file → uploadWorkspaceFile to Java
 *   2. POST /aurora/spark/analyze → insights (textRef, episodeCount, …)
 *   3. saveProduceSeed + saveProduceAutoStart on the *current* projectId
 *   4. The page's seed subscription flips, useProducePipeline consumes
 *      the marker on its next mount-effect tick, the pipeline fires.
 *
 * Differs from the dialog's dropzone: no name / description form (the
 * project already exists and has a name); just the file step.
 */

import { useRef, useState, type DragEvent } from "react";
import { IconCloudUpload, IconFileText, IconLoader2, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import {
  uploadWorkspaceFile,
  type UploadedWorkspaceFile,
} from "@/src/lib/uploads/workspace-upload";
import { useSparkAnalyze } from "@/app/(site)/ips/_hooks/use-spark";
import {
  saveProduceAutoStart,
  saveProduceSeed,
} from "@/app/projects/[id]/produce/_hooks/use-produce-seed";

const SOURCE_MAX_SIZE_MB = 25;
const SOURCE_MAX_SIZE_BYTES = SOURCE_MAX_SIZE_MB * 1024 * 1024;
const SOURCE_ACCEPT = ".pdf,.doc,.docx,.txt,.md";

type SourceFile = Pick<UploadedWorkspaceFile, "path" | "url" | "name" | "size" | "mimeType">;

interface ProduceReseedCardProps {
  projectId: string;
  worldId?: string | null;
  /** Project title — included in the seed payload so downstream agents
   *  preserve the existing world name instead of inventing one. */
  worldName: string;
  description?: string;
}

export function ProduceReseedCard({
  projectId,
  worldId,
  worldName,
  description,
}: ProduceReseedCardProps) {
  const t = useTranslations("produce");
  const tw = useTranslations("ai");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [sourceFile, setSourceFile] = useState<SourceFile | null>(null);
  const sparkAnalyze = useSparkAnalyze();

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const uploaded = await uploadWorkspaceFile(file, {
        uploadType: "WORLD",
        sourceType: "LOCAL",
        accept: SOURCE_ACCEPT,
        maxSize: SOURCE_MAX_SIZE_BYTES,
      });
      setSourceFile(uploaded);
      setAnalyzing(true);
      let draft;
      try {
        draft = await sparkAnalyze.mutateAsync(file);
      } catch (analyzeErr) {
        console.warn("[ProduceReseedCard] spark analyze failed:", analyzeErr);
        toast.error(t("reseedAnalyzeFailed"));
        return;
      } finally {
        setAnalyzing(false);
      }
      // Hand off to the pipeline: write the seed + the one-shot
      // auto-start marker for THIS project. Page's seed selector
      // re-renders, useProducePipeline's mount effect consumes the
      // marker, run kicks off.
      saveProduceSeed(projectId, {
        worldId: worldId ?? undefined,
        worldName,
        description: description ?? "",
        tags: [],
        episodeCount: draft.episodeCount,
        runtimeMinutes: draft.runtimeMinutes,
        language: draft.language,
        roleCount: draft.roleCount,
        sceneCount: draft.sceneCount,
        propCount: draft.propCount,
        sourceFile: {
          name: uploaded.name,
          size: uploaded.size,
          mimeType: uploaded.mimeType,
          path: uploaded.path,
          textRef: draft.textRef,
          chars: draft.sourceChars,
          excerpt: draft.sourceExcerpt,
        },
        createdAt: Date.now(),
      });
      saveProduceAutoStart(projectId);
    } catch (err) {
      console.error("[ProduceReseedCard] upload failed:", err);
      const message = err instanceof Error ? err.message : "";
      if (message === "unsupportedFileType") {
        toast.error(tw("createWorldSourceUnsupported"));
      } else if (message === "fileSizeExceedMb") {
        toast.error(tw("createWorldSourceTooLarge", { size: SOURCE_MAX_SIZE_MB }));
      } else {
        toast.error(tw("createWorldSourceUploadFailed"));
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (uploading || analyzing) return;
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const handlePicker = () => {
    if (uploading || analyzing) return;
    fileInputRef.current?.click();
  };

  const busy = uploading || analyzing;
  const busyLabel = analyzing ? t("reseedAnalyzing") : t("reseedUploading");

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t("reseedTitle")}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("reseedHint")}</p>
        </div>
        {sourceFile && !busy && (
          <Button variant="ghost" color="muted" size="sm" onClick={() => setSourceFile(null)}>
            <IconX className="size-3.5" />
          </Button>
        )}
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={handlePicker}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 bg-background/40 px-4 py-6 text-center transition-colors hover:border-primary/40 hover:bg-primary/5",
          busy && "pointer-events-none opacity-60"
        )}
      >
        {busy ? (
          <>
            <IconLoader2 className="size-5 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">{busyLabel}</p>
          </>
        ) : sourceFile ? (
          <>
            <IconFileText className="size-5 text-primary" />
            <p className="text-xs font-medium text-foreground">{sourceFile.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {(sourceFile.size / 1024).toFixed(1)} KB · {t("reseedReady")}
            </p>
          </>
        ) : (
          <>
            <IconCloudUpload className="size-5 text-muted-foreground" />
            <p className="text-xs font-medium text-foreground">{t("reseedDrop")}</p>
            <p className="text-[11px] text-muted-foreground">
              PDF / DOCX / TXT / MD · {SOURCE_MAX_SIZE_MB}MB
            </p>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={SOURCE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
    </Card>
  );
}
