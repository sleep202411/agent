"use client";

/**
 * In-page upload entry for kicking off Step 1 against fresh source
 * material. Used in the "no seed" branch of `produce/script/page.tsx`
 * — opens via the 一键成片 header button, after a refresh, or after
 * commit returns the user to the script step.
 *
 * Sends the picked file directly to the pipeline (no separate spark
 * /analyze round-trip — the produce flow doesn't need LLM-suggested
 * name / description; the project already has them). The pipeline
 * hook holds the File in React state so a retry on the same mount
 * replays the same bytes without forcing the user to re-pick.
 */

import { useRef, useState, type DragEvent } from "react";
import { IconCloudUpload, IconFileText, IconLoader2, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";

const SOURCE_MAX_SIZE_MB = 25;
const SOURCE_MAX_SIZE_BYTES = SOURCE_MAX_SIZE_MB * 1024 * 1024;
const SOURCE_ACCEPT = ".pdf,.doc,.docx,.txt,.md";

interface ProduceReseedCardProps {
  worldId?: string | null;
  /** Project title — included in the request body so the workflow
   *  preserves the existing world name instead of inventing one. */
  worldName: string;
  description?: string;
  /** Hand the picked file to the pipeline. The hook stores it in
   *  React state and POSTs multipart to the server. */
  onFileReady: (
    file: File,
    opts: { worldId?: string; worldName: string; description?: string }
  ) => void;
}

export function ProduceReseedCard({
  worldId,
  worldName,
  description,
  onFileReady,
}: ProduceReseedCardProps) {
  const t = useTranslations("produce");
  const tw = useTranslations("ai");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [picked, setPicked] = useState<File | null>(null);

  const handleFile = (file: File) => {
    // Client-side size guard — server will also reject, but failing
    // before any network round-trip is friendlier.
    if (file.size > SOURCE_MAX_SIZE_BYTES) {
      toast.error(tw("createWorldSourceTooLarge", { size: SOURCE_MAX_SIZE_MB }));
      return;
    }
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    const allowed = SOURCE_ACCEPT.replace(/\./g, "")
      .split(",")
      .map((s) => s.trim());
    if (!allowed.includes(ext)) {
      toast.error(tw("createWorldSourceUnsupported"));
      return;
    }
    setPicked(file);
    onFileReady(file, {
      worldId: worldId ?? undefined,
      worldName,
      description,
    });
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handlePicker = () => {
    fileInputRef.current?.click();
  };

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t("reseedTitle")}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("reseedHint")}</p>
        </div>
        {picked && (
          <Button variant="ghost" color="muted" size="sm" onClick={() => setPicked(null)}>
            <IconX className="size-3.5" />
          </Button>
        )}
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={handlePicker}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 bg-background/40 px-4 py-6 text-center transition-colors hover:border-primary/40 hover:bg-primary/5"
        )}
      >
        {picked ? (
          <>
            <IconLoader2 className="size-5 animate-spin text-primary" />
            <p className="text-xs font-medium text-foreground">{picked.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {(picked.size / 1024).toFixed(1)} KB · {t("reseedReady")}
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
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
    </Card>
  );
}
