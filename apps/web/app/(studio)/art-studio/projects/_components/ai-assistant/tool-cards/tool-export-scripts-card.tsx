"use client";

import { useCallback, useState } from "react";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { saveAs } from "file-saver";
import { IconDownload, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import type { AssistantToolInvocation } from "@/src/lib/assistant/assistant-types";

/**
 * Tool card for `export_scripts` — the agent tool pre-fetches every episode's
 * script text; this component builds the .docx client-side (keeps the
 * docx/file-saver deps out of the agent) and offers a one-click download.
 *
 * Matches the behaviour of ScriptView's `handleExportAll` but without the
 * per-episode HTTP round-trip (content already in tool output).
 */
interface ExportScriptsOutput {
  ok?: boolean;
  projectName?: string;
  filename?: string;
  episodeCount?: number;
  totalChars?: number;
  episodes?: Array<{ episodeId: string; title: string; content: string }>;
  message?: string;
}

interface ToolExportScriptsCardProps {
  part: AssistantToolInvocation;
}

export function ToolExportScriptsCard({ part }: ToolExportScriptsCardProps) {
  const [downloading, setDownloading] = useState(false);
  const t = useTranslations("ai");

  const handleDownload = useCallback(async () => {
    if (part.state !== "output-available") return;
    const out = part.output as ExportScriptsOutput;
    if (!out.episodes || out.episodes.length === 0) {
      toast.error(t("exportScriptsNone"));
      return;
    }
    setDownloading(true);
    try {
      const projectName = out.projectName || "scripts";
      const paragraphs: Paragraph[] = [
        new Paragraph({
          text: projectName,
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({ text: "" }),
      ];
      for (const ep of out.episodes) {
        paragraphs.push(
          new Paragraph({
            text: ep.title || `Episode ${ep.episodeId}`,
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400 },
          })
        );
        if (!ep.content) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: t("exportScriptsEmptySection"),
                  italics: true,
                  color: "999999",
                }),
              ],
            })
          );
          continue;
        }
        for (const block of ep.content.split(/\n+/).filter(Boolean)) {
          paragraphs.push(new Paragraph({ text: block }));
        }
      }
      const doc = new Document({
        sections: [{ properties: {}, children: paragraphs }],
      });
      const blob = await Packer.toBlob(doc);
      saveAs(blob, out.filename || `${projectName}-all-scripts.docx`);
      toast.success(t("exportScriptsDownloaded"));
    } catch (err) {
      console.error("[export_scripts] download failed:", err);
      toast.error(t("exportScriptsDownloadFailed"));
    } finally {
      setDownloading(false);
    }
  }, [part, t]);

  if (part.state === "output-error") {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
        {t("exportScriptsFailed", { reason: part.errorText ?? "unknown" })}
      </div>
    );
  }

  if (part.state !== "output-available") {
    return (
      <div className="flex items-center gap-2 py-0.5 text-[12px] text-muted-foreground/70">
        <IconLoader2 className="size-3 animate-spin text-muted-foreground/50" />
        <span className="font-medium">{t("exportScriptsPacking")}</span>
      </div>
    );
  }

  const out = part.output as ExportScriptsOutput;
  if (!out.ok || !out.episodes || out.episodes.length === 0) {
    return (
      <div className="rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-[13px] text-muted-foreground">
        {out.message || t("exportScriptsNone")}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">
            {t("exportScriptsReady", {
              name: out.projectName ?? t("exportScriptsDefaultName"),
              count: out.episodeCount ?? 0,
            })}
          </span>
          <span className="text-[12px] text-muted-foreground">
            {t("exportScriptsMeta", {
              chars: (out.totalChars ?? 0).toLocaleString(),
              filename: out.filename ?? "",
            })}
          </span>
        </div>
        <Button
          size="sm"
          onClick={handleDownload}
          disabled={downloading}
          className="shrink-0 gap-1"
        >
          {downloading ? (
            <IconLoader2 className="size-3.5 animate-spin" />
          ) : (
            <IconDownload className="size-3.5" />
          )}
          <span>{t("exportScriptsDownloadButton")}</span>
        </Button>
      </div>
    </div>
  );
}
