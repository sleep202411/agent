"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import type { LookupUserDTO } from "@repo/shared/users";
import { IconAlertCircle, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";

import {
  useCrewProductionOverview,
  useSaveCrewProductionDocument,
  type CrewMemberDTO,
  type CrewProductionDocument,
  type CrewProductionOverviewDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { NotionEditor } from "@/components/tiptap-templates/notion-like/notion-like-editor";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import { ProductionProjectHeader } from "./production-project-header";

interface ProductionOverviewProps {
  crewId: string;
  crewName: string;
  crewSummary: string;
  crewLogo: string;
  crewVersion: number;
  canEditCrewInfo: boolean;
  members: CrewMemberDTO[];
  displays: Map<string, LookupUserDTO>;
  onWriteUpdate: () => void;
}

export function ProductionOverview({
  crewId,
  crewName,
  crewSummary,
  crewLogo,
  crewVersion,
  canEditCrewInfo,
  members,
  displays,
  onWriteUpdate,
}: ProductionOverviewProps) {
  const t = useTranslations("crewProduction");
  const overviewQuery = useCrewProductionOverview(crewId);
  const overview = overviewQuery.data;

  if (overviewQuery.isLoading) return <ProductionLoading label={t("loading")} />;
  if (overviewQuery.isError || !overview) {
    return (
      <ProductionError
        title={t("loadFailed")}
        detail={
          overviewQuery.error instanceof Error ? overviewQuery.error.message : t("loadFailed")
        }
        onRetry={() => void overviewQuery.refetch()}
      />
    );
  }

  return (
    <ProductionDocumentEditor
      crewId={crewId}
      crewName={crewName}
      crewSummary={crewSummary}
      crewLogo={crewLogo}
      crewVersion={crewVersion}
      canEditCrewInfo={canEditCrewInfo}
      members={members}
      displays={displays}
      overview={overview}
      onReload={async () => (await overviewQuery.refetch()).data ?? null}
      onWriteUpdate={onWriteUpdate}
    />
  );
}

function ProductionDocumentEditor({
  crewId,
  crewName,
  crewSummary,
  crewLogo,
  crewVersion,
  canEditCrewInfo,
  members,
  displays,
  overview,
  onReload,
  onWriteUpdate,
}: {
  crewId: string;
  crewName: string;
  crewSummary: string;
  crewLogo: string;
  crewVersion: number;
  canEditCrewInfo: boolean;
  members: CrewMemberDTO[];
  displays: Map<string, LookupUserDTO>;
  overview: CrewProductionOverviewDTO;
  onReload: () => Promise<CrewProductionOverviewDTO | null>;
  onWriteUpdate: () => void;
}) {
  const t = useTranslations("crewProduction");
  const saveDocument = useSaveCrewProductionDocument(crewId);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const editor = useRef<Editor | null>(null);
  const latestDocument = useRef<CrewProductionDocument>(overview.page.document);
  const savedDocument = useRef(JSON.stringify(overview.page.document));
  const inFlightDocument = useRef<string | null>(null);
  const version = useRef(overview.page.version);
  const saveTimer = useRef<number | null>(null);
  const saving = useRef(false);
  const saveBlocked = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const slashMenuLabels = useMemo(
    () => ({
      text: slashLabel(t, "paragraph"),
      heading_1: slashLabel(t, "heading1"),
      heading_2: slashLabel(t, "heading2"),
      heading_3: slashLabel(t, "heading3"),
      bullet_list: slashLabel(t, "bulletList"),
      ordered_list: slashLabel(t, "orderedList"),
      task_list: slashLabel(t, "checklist"),
      quote: slashLabel(t, "blockquote"),
      code_block: slashLabel(t, "codeBlock"),
      emoji: slashLabel(t, "emoji"),
      table: slashLabel(t, "table"),
      divider: slashLabel(t, "divider"),
    }),
    [t]
  );
  const dragMenuLabels = useMemo(
    () => ({
      insertBlock: t("editorUi.insertBlock"),
      blockOptions: t("editorUi.blockOptions"),
      clickForOptions: t("editorUi.clickForOptions"),
      holdForDrag: t("editorUi.holdForDrag"),
      block: t("editorUi.block"),
      paragraph: t("blocks.paragraph"),
      heading1: t("blocks.heading1"),
      heading2: t("blocks.heading2"),
      heading3: t("blocks.heading3"),
      bulletList: t("blocks.bulletList"),
      orderedList: t("blocks.orderedList"),
      taskList: t("blocks.checklist"),
      blockquote: t("blocks.blockquote"),
      codeBlock: t("blocks.codeBlock"),
      turnInto: t("editorUi.turnInto"),
      resetFormatting: t("editorUi.resetFormatting"),
      fitTableToWidth: t("editorUi.fitTableToWidth"),
      clearContents: t("editorUi.clearContents"),
      color: t("editorUi.color"),
      duplicate: t("editorUi.duplicate"),
      copy: t("editorUi.copy"),
      copyLink: t("editorUi.copyLink"),
      delete: t("editorUi.delete"),
    }),
    [t]
  );

  const flush = useCallback(async () => {
    if (saving.current || saveBlocked.current) return;
    const document = latestDocument.current;
    const serialized = JSON.stringify(document);
    if (serialized === savedDocument.current) return;

    saving.current = true;
    inFlightDocument.current = serialized;
    setSaveState("saving");

    try {
      const page = await saveDocument.mutateAsync({
        expectedVersion: version.current,
        document,
      });
      version.current = page.version;
      savedDocument.current = serialized;
      inFlightDocument.current = null;
      setSaveState("saved");
    } catch (error) {
      inFlightDocument.current = null;
      saveBlocked.current = true;
      setSaveState("error");
      toast.error(error instanceof Error ? error.message : t("saveDocumentFailed"));
    } finally {
      saving.current = false;
      if (
        !saveBlocked.current &&
        JSON.stringify(latestDocument.current) !== savedDocument.current
      ) {
        void flushRef.current();
      }
    }
  }, [saveDocument, t]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const handleUpdate = useCallback((document: JSONContent) => {
    latestDocument.current = document as CrewProductionDocument;
    setSaveState("saving");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flushRef.current(), 450);
  }, []);

  useEffect(() => {
    if (overview.page.version <= version.current) return;
    const incoming = JSON.stringify(overview.page.document);

    if (incoming === inFlightDocument.current || incoming === savedDocument.current) {
      version.current = overview.page.version;
      return;
    }
    if (JSON.stringify(latestDocument.current) !== savedDocument.current) {
      saveBlocked.current = true;
      setSaveState("error");
      return;
    }

    editor.current?.commands.setContent(overview.page.document as JSONContent, {
      emitUpdate: false,
      errorOnInvalidContent: true,
    });
    version.current = overview.page.version;
    latestDocument.current = overview.page.document;
    savedDocument.current = incoming;
  }, [overview.page.document, overview.page.version]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(latestDocument.current) === savedDocument.current) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      void flushRef.current();
    };
  }, []);

  const reloadLatest = async () => {
    const reloaded = await onReload();
    if (!reloaded) return;

    editor.current?.commands.setContent(reloaded.page.document as JSONContent, {
      emitUpdate: false,
      errorOnInvalidContent: true,
    });
    version.current = reloaded.page.version;
    latestDocument.current = reloaded.page.document;
    savedDocument.current = JSON.stringify(reloaded.page.document);
    saveBlocked.current = false;
    setSaveState("saved");
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#0f1012]">
      <div className="mx-auto w-full max-w-[1060px] px-6 pb-40 pt-[75px] sm:px-8 lg:px-8">
        <ProductionProjectHeader
          crewId={crewId}
          crewName={crewName}
          crewSummary={crewSummary}
          crewLogo={crewLogo}
          crewVersion={crewVersion}
          canEditCrewInfo={canEditCrewInfo}
          members={members}
          displays={displays}
          overview={overview}
          saveState={saveState}
          onReload={() => void reloadLatest()}
          onWriteUpdate={onWriteUpdate}
        />

        <h3 className="mb-3 mt-10 px-7 text-[12px] font-medium text-[#a7abb2] sm:px-12 lg:px-[72px]">
          {t("description")}
        </h3>

        <NotionEditor
          content={overview.page.document as JSONContent}
          editable={overview.capabilities.manage}
          placeholder={t("placeholder.paragraph")}
          ariaLabel={t("editorLabel")}
          slashMenuFilterPlaceholder={t("slashFilter")}
          slashMenuLabels={slashMenuLabels}
          dragMenuLabels={dragMenuLabels}
          onReady={(instance) => {
            editor.current = instance;
          }}
          onUpdate={handleUpdate}
          onBlur={() => void flushRef.current()}
        />
      </div>
    </main>
  );
}

function slashLabel(t: ReturnType<typeof useTranslations>, key: string) {
  return {
    title: t(`blocks.${key}`),
    subtext: t(`blockDescriptions.${key}`),
    group: t("blockGroups.content"),
  };
}

function ProductionLoading({ label }: { label: string }) {
  return (
    <div className="grid min-h-[420px] flex-1 place-items-center bg-[#0f1012]">
      <div className="flex items-center gap-2 text-[11px] text-[#77777d]">
        <IconLoader2 className="size-4 animate-spin" /> {label}
      </div>
    </div>
  );
}

function ProductionError({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail: string;
  onRetry: () => void;
}) {
  const t = useTranslations("crewProduction");
  return (
    <div className="grid min-h-[420px] flex-1 place-items-center bg-[#0f1012] p-8 text-center">
      <div className="max-w-sm">
        <IconAlertCircle className="mx-auto size-6 text-[#e52227]" />
        <h3 className="mt-3 text-[13px] font-semibold text-[#e5e5e7]">{title}</h3>
        <p className="mt-2 text-[11px] leading-5 text-[#77777d]">{detail}</p>
        <Button className="mt-4" size="sm" onClick={onRetry}>
          {t("retry")}
        </Button>
      </div>
    </div>
  );
}
