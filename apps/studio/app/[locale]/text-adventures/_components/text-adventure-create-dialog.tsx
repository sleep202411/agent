"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { IconAlertTriangle, IconFileTypeDocx, IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { isUploadAbort, uploadFileViaSignedUrl } from "@/lib/media-upload";
import { createCreatorTextAdventure, textAdventureKeys } from "../_lib/text-adventure-api";
import { useTextAdventureOwner } from "./text-adventure-account";
import { TextAdventureWorkbenchSkeleton } from "./text-adventure-workbench";

type CreationPhase = "idle" | "uploading" | "creating" | "upload-error" | "create-error";

interface TextAdventureCreateDialogProps {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TextAdventureCreateDialog({
  userId,
  open,
  onOpenChange,
}: TextAdventureCreateDialogProps) {
  const owner = useTextAdventureOwner(userId);
  const t = useTranslations("textAdventures");
  const common = useTranslations("common");
  const router = useRouter();
  const queryClient = useQueryClient();
  const initialInputRef = useRef<HTMLInputElement>(null);
  const recoveryInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const [phase, setPhase] = useState<CreationPhase>("idle");
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [workbenchEntered, setWorkbenchEntered] = useState(false);

  useEffect(() => () => uploadAbortRef.current?.abort(), []);

  useEffect(() => {
    if (phase !== "uploading" && phase !== "creating") return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [phase]);

  const reset = () => {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    setPhase("idle");
    setFileName("");
    setProgress(0);
    setError(null);
    setWorkbenchEntered(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && phase === "uploading") return;
    if (nextOpen && phase !== "idle") reset();
    onOpenChange(nextOpen);
  };

  const createFromUploadedDocument = async (worldviewDocxUrl: string) => {
    const operation = owner.begin();
    setWorkbenchEntered(true);
    setPhase("creating");
    setError(null);
    onOpenChange(false);
    try {
      const game = await createCreatorTextAdventure({ worldviewDocxUrl }, operation.signal);
      if (!operation.current()) return;
      queryClient.setQueryData(textAdventureKeys.detail(game.gameId, userId), game);
      void queryClient.invalidateQueries({ queryKey: textAdventureKeys.list(userId) });
      router.replace(`/text-adventures/${game.gameId}`);
    } catch (reason) {
      if (!operation.current()) return;
      setError(errorMessage(reason, t("actions.unknownError")));
      setPhase("create-error");
    }
  };

  const acceptFile = async (file: File) => {
    if (busy.current || phase === "uploading" || phase === "creating") return;
    if (!file.name.toLowerCase().endsWith(".docx")) {
      setError(t("create.docxOnly"));
      setPhase("upload-error");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(t("create.tooLarge"));
      setPhase("upload-error");
      return;
    }

    const operation = owner.begin();
    busy.current = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    operation.signal.addEventListener("abort", abort, { once: true });
    uploadAbortRef.current = controller;
    setFileName(file.name);
    setProgress(0);
    setError(null);
    setPhase("uploading");
    try {
      const uploaded = await uploadFileViaSignedUrl(file, {
        kind: "agent_attachment_document",
        signal: controller.signal,
        onProgress: setProgress,
      });
      uploadAbortRef.current = null;
      if (!operation.current()) return;
      await createFromUploadedDocument(uploaded.url);
    } catch (reason) {
      uploadAbortRef.current = null;
      if (isUploadAbort(reason) || !operation.current()) return;
      setError(errorMessage(reason, t("actions.unknownError")));
      setPhase("upload-error");
    } finally {
      busy.current = false;
      operation.signal.removeEventListener("abort", abort);
    }
  };

  return (
    <>
      <Dialog open={open && !workbenchEntered} onOpenChange={handleOpenChange}>
        <DialogContent
          className="gap-0 p-6 sm:max-w-xl"
          showCloseButton={phase !== "uploading"}
          onEscapeKeyDown={(event) => {
            if (phase === "uploading") event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (phase === "uploading") event.preventDefault();
          }}
        >
          <DialogHeader className="pr-10">
            <DialogTitle className="text-xl font-semibold text-white">
              {t("library.create")}
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm leading-6 text-white/45">
              {t("create.body")}
            </DialogDescription>
          </DialogHeader>

          <HiddenDocumentInput inputRef={initialInputRef} onFile={acceptFile} />

          {phase === "uploading" ? (
            <UploadProgressCard
              fileName={fileName}
              progress={progress}
              label={t("create.uploading", { progress })}
            />
          ) : (
            <DocumentDropzone
              title={t("create.dropTitle")}
              hint={t("create.dropHint")}
              onChoose={() => initialInputRef.current?.click()}
              onFile={(file) => void acceptFile(file)}
            />
          )}

          {phase === "upload-error" && error ? (
            <div
              className="mt-4 flex items-start gap-3 rounded-2xl bg-destructive/10 p-4"
              role="alert"
            >
              <IconAlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" stroke={1.6} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-destructive">{t("create.uploadFailed")}</p>
                <p className="mt-1 break-words text-xs leading-5 text-destructive/75">{error}</p>
              </div>
            </div>
          ) : null}

          <p className="mt-4 text-xs leading-5 text-white/28">{t("create.privacy")}</p>
        </DialogContent>
      </Dialog>

      {workbenchEntered ? (
        <div className="fixed inset-0 z-[70] bg-[var(--canvas-background)]">
          <TextAdventureWorkbenchSkeleton label={t("create.analyzingTitle")} />
          {phase === "creating" ? (
            <div className="pointer-events-none fixed inset-0 z-[71] grid place-items-center px-5">
              <div className="flex max-w-sm flex-col items-center text-center" aria-live="polite">
                <span className="grid size-12 place-items-center rounded-2xl bg-white/[0.06] text-white/66">
                  <IconSparkles className="size-6 animate-pulse" stroke={1.5} />
                </span>
                <p className="mt-4 text-sm font-medium text-white/76">
                  {t("create.analyzingTitle")}
                </p>
                <p className="mt-2 text-xs leading-5 text-white/38">{t("create.analyzingBody")}</p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <Dialog open={workbenchEntered && phase !== "creating"} onOpenChange={() => undefined}>
        <DialogContent
          className="z-[81] gap-0 p-6 sm:max-w-xl"
          overlayClassName="z-[80]"
          showCloseButton={false}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-white">
              {phase === "uploading" ? t("create.reuploadingTitle") : t("create.reuploadTitle")}
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm leading-6 text-white/45">
              {t("create.reuploadBody")}
            </DialogDescription>
          </DialogHeader>

          <HiddenDocumentInput inputRef={recoveryInputRef} onFile={acceptFile} />

          {phase === "uploading" ? (
            <UploadProgressCard
              fileName={fileName}
              progress={progress}
              label={t("create.uploading", { progress })}
            />
          ) : (
            <DocumentDropzone
              title={t("create.dropTitle")}
              hint={t("create.dropHint")}
              onChoose={() => recoveryInputRef.current?.click()}
              onFile={(file) => void acceptFile(file)}
            />
          )}

          {error ? (
            <div
              className="mt-4 flex items-start gap-3 rounded-2xl bg-destructive/10 p-4"
              role="alert"
            >
              <IconAlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" stroke={1.6} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-destructive">
                  {phase === "create-error" ? t("create.failed") : t("create.uploadFailed")}
                </p>
                <p className="mt-1 break-words text-xs leading-5 text-destructive/75">{error}</p>
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                reset();
                onOpenChange(false);
                void queryClient.invalidateQueries({ queryKey: textAdventureKeys.list(userId) });
              }}
            >
              {common("cancel")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function HiddenDocumentInput({
  inputRef,
  onFile,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void | Promise<void>;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      className="hidden"
      aria-hidden="true"
      tabIndex={-1}
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void onFile(file);
        event.target.value = "";
      }}
    />
  );
}

function UploadProgressCard({
  fileName,
  progress,
  label,
}: {
  fileName: string;
  progress: number;
  label: string;
}) {
  return (
    <div className="mt-6 rounded-2xl bg-white/[0.045] p-5" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/70">
          <IconFileTypeDocx className="size-5" stroke={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white/82">{fileName}</p>
          <p className="mt-0.5 text-xs text-white/38">{label}</p>
        </div>
      </div>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function DocumentDropzone({
  title,
  hint,
  onChoose,
  onFile,
}: {
  title: string;
  hint: string;
  onChoose: () => void;
  onFile: (file: File) => void;
}) {
  return (
    <button
      type="button"
      onClick={onChoose}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      className="mt-6 flex min-h-48 w-full flex-col items-center justify-center rounded-2xl bg-white/[0.035] px-6 outline outline-1 -outline-offset-1 outline-dashed outline-white/12 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      <IconFileTypeDocx className="size-9 text-white/42" stroke={1.5} />
      <span className="mt-4 text-sm font-medium text-white/82">{title}</span>
      <span className="mt-1 text-xs text-white/35">{hint}</span>
    </button>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
