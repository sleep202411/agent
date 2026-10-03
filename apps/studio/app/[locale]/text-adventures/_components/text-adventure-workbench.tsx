/* eslint-disable @next/next/no-img-element -- creator-provided CDN URLs are dynamic */
"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBook2,
  IconCheck,
  IconChevronRight,
  IconCloudOff,
  IconCloudUpload,
  IconExternalLink,
  IconFileDescription,
  IconFileTypeDocx,
  IconLoader2,
  IconMessageCircle,
  IconMusic,
  IconPencil,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconSend2,
  IconTrash,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  isTextGameCreatorActionAllowed,
  isTextGameEditableByCreator,
  TEXT_GAME_STREAMING_ASSISTANT_ID,
  TextGameLocaleSchema,
  type TextGameCreatorAction,
  type TextGameDetail,
  type TextGameMessage,
  type TextGamePlaySession,
} from "@repo/shared/text-game";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FIELD_CONTROL, FIELD_CONTROL_TEXTAREA } from "@/components/ui/field";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/i18n/navigation";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import { getWebBaseUrl } from "@/lib/web-base";
import { useSiteRegion } from "@/app/_components/region-provider";
import {
  getCreatorTextAdventure,
  textAdventureKeys,
  transitionCreatorTextAdventure,
  updateCreatorTextAdventure,
} from "../_lib/text-adventure-api";
import {
  getPlayingTextAdventureSession,
  loadOrStartTextAdventureSession,
  sendTextAdventureAction,
  startTextAdventureSession,
  textAdventureSessionKeys,
} from "../_lib/text-adventure-session-api";
import {
  textAdventureDraftFormFromDetail,
  toTextAdventureUpdateInput,
  type TextAdventureDraftForm,
} from "../_lib/text-adventure-draft";
import { TextAdventureAccount, useTextAdventureOwner } from "./text-adventure-account";
import { TextAdventureStreamBody } from "./text-adventure-stream-body";

type UploadTarget = "poster" | "document" | "stills" | "bgm" | null;
type InspectorPanel = "basics" | "characters" | "stills";

export function TextAdventureWorkbench({ adventureId }: { adventureId: string }) {
  return (
    <TextAdventureAccount>
      {(userId) => <OwnedWorkbench key={adventureId} userId={userId} adventureId={adventureId} />}
    </TextAdventureAccount>
  );
}

function OwnedWorkbench({ adventureId, userId }: { adventureId: string; userId: string }) {
  const t = useTranslations("textAdventures");
  const query = useQuery({
    queryKey: textAdventureKeys.detail(adventureId, userId),
    queryFn: ({ signal }) => getCreatorTextAdventure(adventureId, signal),
  });

  if (query.isLoading) return <TextAdventureWorkbenchSkeleton />;
  if (query.isError || !query.data) {
    return (
      <main className="grid min-h-[calc(100vh-4rem)] place-items-center px-6">
        <FrostedPanel className="w-full max-w-lg p-6 text-center" role="alert">
          <IconAlertTriangle className="mx-auto size-9 text-destructive" stroke={1.5} />
          <h1 className="mt-4 text-lg font-semibold">{t("editor.loadFailed")}</h1>
          <p className="mt-2 break-words text-sm leading-6 text-white/42">
            {query.error instanceof Error ? query.error.message : t("editor.loadFailed")}
          </p>
          <Button className="mt-5" variant="secondary" onClick={() => void query.refetch()}>
            <IconRefresh data-icon="inline-start" />
            {t("actions.retry")}
          </Button>
        </FrostedPanel>
      </main>
    );
  }

  return <LoadedWorkbench key={query.data.gameId} initial={query.data} userId={userId} />;
}

function LoadedWorkbench({ initial, userId }: { initial: TextGameDetail; userId: string }) {
  const owner = useTextAdventureOwner(userId);
  const t = useTranslations("textAdventures");
  const locale = useLocale();
  const region = useSiteRegion();
  const queryClient = useQueryClient();
  const posterInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const stillInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const [game, setGame] = useState(initial);
  const [form, setForm] = useState<TextAdventureDraftForm>(() =>
    textAdventureDraftFormFromDetail(initial)
  );
  const [baseline, setBaseline] = useState<TextAdventureDraftForm>(() =>
    textAdventureDraftFormFromDetail(initial)
  );
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<UploadTarget>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [inspectorPanel, setInspectorPanel] = useState<InspectorPanel | null>(null);

  const editable = isTextGameEditableByCreator(game.status);
  const editorBusy = saving || transitioning || uploadTarget !== null;
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [form, baseline]);
  const missingRequirements = [
    form.name.trim() ? null : t("publish.requirements.name"),
    form.posterUrl ? null : t("publish.requirements.poster"),
    form.synopsis.trim() ? null : t("publish.requirements.synopsis"),
    form.worldviewDocxUrl ? null : t("publish.requirements.document"),
  ].filter((requirement): requirement is string => requirement !== null);
  const requiredReady = missingRequirements.length === 0;
  const hasUnpublishedDraft =
    game.publishedVersionId !== null && game.draftVersionId !== game.publishedVersionId;
  const worldviewFileName = attachmentFileName(
    form.worldviewDocxUrl,
    t("editor.worldviewFileFallback")
  );
  const musicFileName = attachmentFileName(form.bgmUrl, t("editor.musicFileFallback"));
  const attachmentUpdatedAt = t("editor.workUpdatedAt", {
    date: formatAttachmentDate(game.updatedAt, locale),
  });

  useEffect(() => {
    if (!dirty && !saving && !transitioning && uploadTarget === null) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty, saving, transitioning, uploadTarget]);

  const syncGame = (next: TextGameDetail) => {
    if (!owner.current()) return;
    const nextForm = textAdventureDraftFormFromDetail(next);
    setGame(next);
    setForm(nextForm);
    setBaseline(nextForm);
    queryClient.setQueryData(textAdventureKeys.detail(next.gameId, userId), next);
    void queryClient.invalidateQueries({ queryKey: textAdventureKeys.list(userId) });
  };

  const saveForm = async (
    patch: Partial<TextAdventureDraftForm> = {},
    successMessage: string | null = t("editor.saved")
  ): Promise<TextGameDetail> => {
    const operation = owner.begin();
    const nextForm = { ...form, ...patch };
    setSaving(true);
    try {
      const next = await updateCreatorTextAdventure(
        game.gameId,
        toTextAdventureUpdateInput(nextForm, baseline),
        operation.signal
      );
      operation.assert();
      syncGame(next);
      if (successMessage) toast.success(successMessage);
      return next;
    } finally {
      if (operation.current()) setSaving(false);
    }
  };

  const saveWithFeedback = async (patch: Partial<TextAdventureDraftForm> = {}) => {
    try {
      await saveForm(patch);
    } catch (error) {
      if (owner.current()) toast.error(errorMessage(error, t("actions.unknownError")));
    }
  };

  const uploadOne = async (
    target: Exclude<UploadTarget, null>,
    file: File,
    kind: "episode_cover" | "agent_attachment_document" | "ai_reference_image" | "story_music_audio"
  ): Promise<string> => {
    const operation = owner.begin();
    setUploadTarget(target);
    setUploadProgress(0);
    try {
      const result = await uploadFileViaSignedUrl(file, {
        kind,
        signal: operation.signal,
        onProgress: (value) => {
          if (operation.current()) setUploadProgress(value);
        },
      });
      operation.assert();
      return result.url;
    } finally {
      if (operation.current()) {
        setUploadTarget(null);
        setUploadProgress(0);
      }
    }
  };

  const uploadPoster = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(t("editor.posterImageOnly"));
      return;
    }

    try {
      const posterUrl = await uploadOne("poster", file, "episode_cover");
      await saveForm({ posterUrl });
    } catch (error) {
      if (owner.current()) toast.error(errorMessage(error, t("actions.unknownError")));
    }
  };

  const replaceDocument = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      toast.error(t("create.docxOnly"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("create.tooLarge"));
      return;
    }
    try {
      const worldviewDocxUrl = await uploadOne("document", file, "agent_attachment_document");
      await saveForm({ worldviewDocxUrl }, t("editor.documentReparsed"));
    } catch (error) {
      if (owner.current()) toast.error(errorMessage(error, t("actions.unknownError")));
    }
  };

  const uploadStills = async (files: File[]) => {
    if (files.length === 0) return;
    if (files.some((file) => !file.type.startsWith("image/"))) {
      toast.error(t("editor.stillsImageOnly"));
      return;
    }
    const operation = owner.begin();
    setUploadTarget("stills");
    try {
      const urls: string[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const result = await uploadFileViaSignedUrl(files[index], {
          kind: "ai_reference_image",
          signal: operation.signal,
          onProgress: (value) =>
            setUploadProgress(Math.round(((index + value / 100) / files.length) * 100)),
        });
        operation.assert();
        urls.push(result.url);
      }
      await saveForm({ stillUrls: [...form.stillUrls, ...urls] });
    } catch (error) {
      if (owner.current()) toast.error(errorMessage(error, t("actions.unknownError")));
    } finally {
      if (operation.current()) {
        setUploadTarget(null);
        setUploadProgress(0);
      }
    }
  };

  const uploadBgm = async (file: File) => {
    const fileName = file.name.toLowerCase();
    if (
      !file.type.startsWith("audio/") &&
      !fileName.endsWith(".mp3") &&
      !fileName.endsWith(".wav")
    ) {
      toast.error(t("editor.musicAudioOnly"));
      return;
    }
    try {
      const bgmUrl = await uploadOne("bgm", file, "story_music_audio");
      await saveForm({ bgmUrl });
    } catch (error) {
      if (owner.current()) toast.error(errorMessage(error, t("actions.unknownError")));
    }
  };

  const transition = async (action: TextGameCreatorAction) => {
    if (!isTextGameCreatorActionAllowed(game.status, action)) return;
    const operation = owner.begin();
    setTransitioning(true);
    try {
      let current = game;
      if (dirty && editable) current = await saveForm({}, null);
      operation.assert();
      const next = await transitionCreatorTextAdventure(current.gameId, action, operation.signal);
      operation.assert();
      syncGame(next);
      toast.success(action === "submit" ? t("publish.submitted") : t("publish.offlined"));
    } catch (error) {
      if (owner.current()) toast.error(errorMessage(error, t("actions.unknownError")));
    } finally {
      if (operation.current()) setTransitioning(false);
    }
  };

  const publicUrl = `${getWebBaseUrl(region)}/${locale}/play/text-game/${encodeURIComponent(game.gameId)}`;

  return (
    <main className="flex min-h-dvh flex-col bg-[var(--canvas-background)] min-[1100px]:fixed min-[1100px]:inset-0 min-[1100px]:h-dvh min-[1100px]:overflow-hidden">
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 bg-black/10 px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Button asChild variant="quiet" size="icon" aria-label={t("actions.backToLibrary")}>
            <Link href="/text-adventures">
              <IconArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white/86">
              {form.name || t("library.untitled")}
            </p>
            <p className="text-[11px] text-white/34">
              {t(`status.${game.status}`)} ·{" "}
              {t("editor.version", { version: game.content.versionNo })}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="hidden items-center gap-1.5 text-xs text-white/35 min-[1180px]:inline-flex">
            {dirty ? null : <IconCheck className="size-3.5" stroke={1.8} />}
            {dirty ? t("editor.unsaved") : t("editor.saved")}
          </span>
          <Button
            variant="secondary"
            aria-label={t("actions.save")}
            className="size-9 px-0 min-[740px]:w-auto min-[740px]:px-3.5"
            disabled={!editable || !dirty || editorBusy}
            loading={saving}
            onClick={() => void saveWithFeedback()}
          >
            {saving ? null : <IconCheck />}
            <span className="hidden min-[740px]:inline">{t("actions.save")}</span>
          </Button>

          {game.status === "published" ? (
            <Button
              asChild
              variant="quiet"
              aria-label={t("publish.viewLive")}
              className="size-9 px-0 min-[740px]:w-auto min-[740px]:px-3.5"
            >
              <a href={publicUrl} target="_blank" rel="noreferrer">
                <IconExternalLink data-icon="inline-start" />
                <span className="hidden min-[740px]:inline">{t("publish.viewLive")}</span>
              </a>
            </Button>
          ) : null}

          {isTextGameCreatorActionAllowed(game.status, "submit") ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="primary-cta"
                  aria-label={
                    game.status === "published" ? t("publish.submitUpdate") : t("publish.submit")
                  }
                  className="size-9 px-0 min-[740px]:w-auto min-[740px]:px-3.5"
                  disabled={editorBusy}
                >
                  <IconCloudUpload data-icon="inline-start" />
                  <span className="hidden min-[740px]:inline">
                    {game.status === "published" ? t("publish.submitUpdate") : t("publish.submit")}
                  </span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                {requiredReady ? (
                  <>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("publish.submitConfirmTitle")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("publish.submitConfirmBody")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel variant="quiet">{t("actions.cancel")}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void transition("submit")}>
                        {t("publish.submitConfirm")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </>
                ) : (
                  <>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("publish.validationTitle")}</AlertDialogTitle>
                      <AlertDialogDescription>{t("publish.validationBody")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <ul className="space-y-2 px-6 pb-2 text-sm text-white/68">
                      {missingRequirements.map((requirement) => (
                        <li key={requirement} className="flex items-center gap-2">
                          <span className="size-1.5 rounded-full bg-destructive" />
                          {requirement}
                        </li>
                      ))}
                    </ul>
                    <AlertDialogFooter>
                      <AlertDialogAction>{t("publish.validationAction")}</AlertDialogAction>
                    </AlertDialogFooter>
                  </>
                )}
              </AlertDialogContent>
            </AlertDialog>
          ) : null}

          {isTextGameCreatorActionAllowed(game.status, "offline") ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  aria-label={t("publish.takeOffline")}
                  className="size-9 px-0 min-[740px]:w-auto min-[740px]:px-3.5"
                  disabled={editorBusy}
                >
                  <IconCloudOff data-icon="inline-start" />
                  <span className="hidden min-[740px]:inline">{t("publish.takeOffline")}</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("publish.offlineConfirmTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("publish.offlineConfirmBody")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel variant="quiet">{t("actions.cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => void transition("offline")}
                  >
                    {t("publish.offlineConfirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </div>

      <div className="grid min-h-[calc(100dvh-3.5rem)] flex-1 grid-cols-1 min-[1100px]:min-h-0 min-[1100px]:grid-cols-[minmax(0,1fr)_380px]">
        <section className="h-[calc(100dvh-3.5rem)] min-h-[620px] min-w-0 p-3 sm:p-5 min-[1100px]:h-full min-[1100px]:min-h-0 lg:p-6">
          <TextAdventureConversation
            userId={userId}
            game={game}
            hasUnpublishedDraft={hasUnpublishedDraft}
          />
        </section>

        <aside
          aria-label={t("editor.inspectorTitle")}
          className="min-w-0 bg-[#131416] min-[1100px]:h-full min-[1100px]:overflow-hidden"
        >
          {inspectorPanel === null ? (
            <div className="px-4 py-5 sm:px-5 min-[1100px]:h-full min-[1100px]:overflow-y-auto">
              <section aria-labelledby="creator-work-title">
                <input
                  ref={posterInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-hidden="true"
                  tabIndex={-1}
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadPoster(file);
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  aria-label={form.posterUrl ? t("editor.replacePoster") : t("editor.uploadPoster")}
                  disabled={!editable || editorBusy}
                  className="group relative aspect-[2/3] w-40 overflow-hidden rounded-xl bg-white/[0.055] text-white/24 outline-none transition-opacity hover:opacity-88 focus-visible:ring-2 focus-visible:ring-white/35 disabled:pointer-events-none"
                  onClick={() => posterInputRef.current?.click()}
                >
                  {form.posterUrl ? (
                    <img src={form.posterUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="grid size-full place-items-center">
                      <IconPhoto className="size-7" stroke={1.4} />
                    </span>
                  )}
                  <span className="absolute top-2 right-2 grid size-8 place-items-center rounded-xl bg-black/62 text-white/72 backdrop-blur-sm transition-colors group-hover:bg-black/78 group-hover:text-white">
                    {uploadTarget === "poster" ? (
                      <IconLoader2 className="size-4 animate-spin" />
                    ) : (
                      <IconPencil className="size-4" stroke={1.8} />
                    )}
                  </span>
                </button>
                <div className="mt-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <h2
                      id="creator-work-title"
                      className="truncate text-[15px] font-semibold tracking-[-0.015em] text-white/92"
                    >
                      {form.name.trim() || t("library.untitled")}
                    </h2>
                    <p className="mt-0.5 text-xs text-white/40">{t("library.eyebrow")}</p>
                  </div>
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={!editable || editorBusy}
                    onClick={() => setInspectorPanel("basics")}
                  >
                    <IconPencil data-icon="inline-start" />
                    {t("editor.edit")}
                  </Button>
                </div>
                <p className="mt-4 line-clamp-3 text-xs leading-5 text-white/46">
                  {form.synopsis.trim() || t("library.noSynopsis")}
                </p>
              </section>

              {!editable ? (
                <FrostedPanel className="mt-5 flex items-start gap-3 p-4">
                  <IconFileDescription
                    className="mt-0.5 size-5 shrink-0 text-white/55"
                    stroke={1.6}
                  />
                  <div>
                    <p className="text-sm font-medium">{t("editor.reviewLockedTitle")}</p>
                    <p className="mt-1 text-xs leading-5 text-white/40">
                      {t("editor.reviewLockedBody")}
                    </p>
                  </div>
                </FrostedPanel>
              ) : null}

              {game.rejectReason ? (
                <FrostedPanel className="mt-5 bg-destructive/[0.08] p-4" role="alert">
                  <p className="text-xs font-semibold uppercase tracking-[0.09em] text-destructive">
                    {t("publish.rejected")}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-white/68">{game.rejectReason}</p>
                </FrostedPanel>
              ) : null}

              <section className="mt-6" aria-labelledby="worldview-attachment-title">
                <h3
                  id="worldview-attachment-title"
                  className="mb-2 text-xs font-semibold text-white/58"
                >
                  {t("editor.sections.worldview")}
                </h3>
                <input
                  ref={documentInputRef}
                  type="file"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  aria-hidden="true"
                  tabIndex={-1}
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void replaceDocument(file);
                    event.target.value = "";
                  }}
                />
                <AttachmentRow
                  icon={IconFileTypeDocx}
                  name={worldviewFileName}
                  meta={attachmentUpdatedAt}
                  actionLabel={form.worldviewDocxUrl ? t("editor.replace") : t("editor.upload")}
                  actionIcon={form.worldviewDocxUrl ? IconRefresh : IconPlus}
                  disabled={!editable || editorBusy}
                  loading={uploadTarget === "document" || saving}
                  onAction={() => documentInputRef.current?.click()}
                />
              </section>

              <section className="mt-5" aria-labelledby="music-attachment-title">
                <h3
                  id="music-attachment-title"
                  className="mb-2 text-xs font-semibold text-white/58"
                >
                  {t("editor.sections.music")}
                </h3>
                <input
                  ref={musicInputRef}
                  type="file"
                  accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
                  aria-hidden="true"
                  tabIndex={-1}
                  className="sr-only"
                  disabled={!editable || editorBusy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadBgm(file);
                    event.target.value = "";
                  }}
                />
                <AttachmentRow
                  icon={IconMusic}
                  name={form.bgmUrl ? musicFileName : t("editor.noMusic")}
                  meta={form.bgmUrl ? attachmentUpdatedAt : t("editor.notAdded")}
                  actionLabel={form.bgmUrl ? t("editor.replace") : t("editor.upload")}
                  actionIcon={form.bgmUrl ? IconRefresh : IconPlus}
                  disabled={!editable || editorBusy}
                  loading={uploadTarget === "bgm"}
                  onAction={() => musicInputRef.current?.click()}
                  removeLabel={form.bgmUrl ? t("editor.removeMusic") : undefined}
                  onRemove={form.bgmUrl ? () => void saveWithFeedback({ bgmUrl: "" }) : undefined}
                />
              </section>

              <nav className="mt-5 space-y-0.5" aria-label={t("editor.inspectorTitle")}>
                <InspectorMenuButton
                  icon={IconUsers}
                  label={t("editor.sections.characters")}
                  value={t("preview.castCount", { count: game.content.characters.length })}
                  onClick={() => setInspectorPanel("characters")}
                />
                <InspectorMenuButton
                  icon={IconPhoto}
                  label={t("editor.sections.stills")}
                  value={t("editor.stillsCount", { count: form.stillUrls.length })}
                  onClick={() => setInspectorPanel("stills")}
                />
              </nav>
            </div>
          ) : (
            <div className="flex min-h-0 flex-col min-[1100px]:h-full">
              <div className="flex h-14 shrink-0 items-center gap-3 px-4">
                <Button
                  variant="quiet"
                  size="icon-sm"
                  aria-label={t("editor.backToOverview")}
                  onClick={() => setInspectorPanel(null)}
                >
                  <IconArrowLeft />
                </Button>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-white/86">
                    {t(`editor.sections.${inspectorPanel}`)}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-white/34">{t("editor.inspectorTitle")}</p>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-6">
                {inspectorPanel === "basics" ? (
                  <>
                    <Field label={t("editor.name")} htmlFor="text-adventure-name" required dense>
                      <Input
                        id="text-adventure-name"
                        value={form.name}
                        disabled={!editable || editorBusy}
                        aria-required="true"
                        maxLength={120}
                        className={FIELD_CONTROL}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, name: event.target.value }))
                        }
                      />
                    </Field>
                    <Field
                      label={t("editor.synopsis")}
                      htmlFor="text-adventure-synopsis"
                      required
                      dense
                    >
                      <Textarea
                        id="text-adventure-synopsis"
                        value={form.synopsis}
                        disabled={!editable || editorBusy}
                        aria-required="true"
                        maxLength={1_000}
                        className={FIELD_CONTROL_TEXTAREA}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, synopsis: event.target.value }))
                        }
                      />
                    </Field>
                  </>
                ) : null}

                {inspectorPanel === "characters" ? (
                  <>
                    {game.content.characters.length === 0 ? (
                      <p className="rounded-2xl bg-white/[0.035] px-4 py-5 text-center text-xs leading-5 text-white/35">
                        {t("editor.noCharacters")}
                      </p>
                    ) : (
                      <div className="space-y-0.5">
                        {game.content.characters
                          .slice()
                          .sort((a, b) => a.sortOrder - b.sortOrder)
                          .map((character) => (
                            <div
                              key={character.id}
                              className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-white/[0.04]"
                            >
                              <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-white/[0.06] text-white/40">
                                {character.avatarUrl ? (
                                  <img
                                    src={character.avatarUrl}
                                    alt=""
                                    className="size-full object-cover"
                                  />
                                ) : (
                                  <IconUser className="size-4" stroke={1.5} />
                                )}
                              </span>
                              <div className="min-w-0 pt-0.5">
                                <p className="truncate text-sm font-medium text-white/76">
                                  {character.name}
                                </p>
                                <p className="mt-0.5 text-xs leading-[1.15rem] text-white/36">
                                  {character.intro}
                                </p>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                    <p className="text-[11px] leading-5 text-white/30">
                      {t("editor.charactersReadOnly")}
                    </p>
                  </>
                ) : null}

                {inspectorPanel === "stills" ? (
                  <>
                    <input
                      ref={stillInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      aria-label={t("editor.addStills")}
                      className="sr-only"
                      onChange={(event) => {
                        void uploadStills(Array.from(event.target.files ?? []));
                        event.target.value = "";
                      }}
                    />
                    {form.stillUrls.length > 0 ? (
                      <div className="grid grid-cols-2 gap-2">
                        {form.stillUrls.map((url, index) => (
                          <div
                            key={`${url}:${index}`}
                            className="group relative aspect-video overflow-hidden rounded-xl bg-white/[0.04]"
                          >
                            <img src={url} alt="" className="size-full object-cover" />
                            {editable ? (
                              <Button
                                variant="quiet"
                                size="icon-sm"
                                disabled={editorBusy}
                                aria-label={t("editor.removeStill", { index: index + 1 })}
                                className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                                onClick={() =>
                                  void saveWithFeedback({
                                    stillUrls: form.stillUrls.filter(
                                      (_, candidate) => candidate !== index
                                    ),
                                  })
                                }
                              >
                                <IconTrash />
                              </Button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-2xl bg-white/[0.035] px-4 py-5 text-center text-xs text-white/35">
                        {t("editor.noStills")}
                      </p>
                    )}
                    <Button
                      block
                      variant="secondary"
                      disabled={!editable || editorBusy}
                      loading={uploadTarget === "stills"}
                      onClick={() => stillInputRef.current?.click()}
                    >
                      <IconPlus data-icon="inline-start" />
                      {uploadTarget === "stills"
                        ? t("editor.uploadProgress", { progress: uploadProgress })
                        : t("editor.addStills")}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function TextAdventureConversation({
  userId,
  game,
  hasUnpublishedDraft,
}: {
  userId: string;
  game: TextGameDetail;
  hasUnpublishedDraft: boolean;
}) {
  const owner = useTextAdventureOwner(userId);
  const t = useTranslations("textAdventures");
  const locale = TextGameLocaleSchema.parse(useLocale());
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const restartingRef = useRef(false);
  const canPlay = game.publishedVersionId !== null;

  const sessionQuery = useQuery({
    queryKey: textAdventureSessionKeys.detail(game.gameId, locale, userId),
    queryFn: ({ signal }) =>
      loadOrStartTextAdventureSession(
        game.gameId,
        locale,
        {
          onSession: (next) => {
            if (!signal.aborted && owner.current())
              queryClient.setQueryData(
                textAdventureSessionKeys.detail(game.gameId, locale, userId),
                next
              );
          },
        },
        signal
      ),
    enabled: canPlay,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const session = sessionQuery.data;
  const messages = session?.messages ?? [];
  const lastMessageContent = messages.at(-1)?.content ?? "";
  const streamingAssistant = messages.some(
    (message) => message.id === TEXT_GAME_STREAMING_ASSISTANT_ID
  );

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;
    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior: messages.length > 1 || sending ? "smooth" : "auto",
    });
  }, [messages.length, lastMessageContent, sending]);

  const submitAction = async () => {
    const value = draft.trim();
    if (!value || !session || sendingRef.current || restartingRef.current) return;

    const operation = owner.begin();
    const optimisticId = `pending-${Date.now()}`;
    const optimistic: TextGameMessage = {
      id: optimisticId,
      role: "user",
      content: value,
      createdAt: new Date().toISOString(),
    };
    sendingRef.current = true;
    setDraft("");
    setSending(true);
    queryClient.setQueryData<TextGamePlaySession>(
      textAdventureSessionKeys.detail(game.gameId, locale, userId),
      (current) =>
        current
          ? {
              ...current,
              messages: [
                ...current.messages,
                optimistic,
                {
                  id: TEXT_GAME_STREAMING_ASSISTANT_ID,
                  role: "assistant",
                  content: "",
                  createdAt: optimistic.createdAt,
                },
              ],
            }
          : current
    );

    try {
      await sendTextAdventureAction(
        session.sessionId,
        value,
        locale,
        {
          onUserMessage: (userMessage) => {
            if (!operation.current()) return;
            queryClient.setQueryData<TextGamePlaySession>(
              textAdventureSessionKeys.detail(game.gameId, locale, userId),
              (current) =>
                current
                  ? {
                      ...current,
                      messages: current.messages.map((item) =>
                        item.id === optimisticId ? userMessage : item
                      ),
                    }
                  : current
            );
          },
          onAssistantDelta: (text) => {
            if (!operation.current()) return;
            queryClient.setQueryData<TextGamePlaySession>(
              textAdventureSessionKeys.detail(game.gameId, locale, userId),
              (current) =>
                current
                  ? {
                      ...current,
                      messages: current.messages.map((item) =>
                        item.id === TEXT_GAME_STREAMING_ASSISTANT_ID
                          ? { ...item, content: `${item.content}${text}` }
                          : item
                      ),
                    }
                  : current
            );
          },
          onAssistantDone: (assistantMessage) => {
            if (!operation.current()) return;
            queryClient.setQueryData<TextGamePlaySession>(
              textAdventureSessionKeys.detail(game.gameId, locale, userId),
              (current) =>
                current
                  ? {
                      ...current,
                      messages: current.messages.map((item) =>
                        item.id === TEXT_GAME_STREAMING_ASSISTANT_ID ? assistantMessage : item
                      ),
                    }
                  : current
            );
          },
        },
        operation.signal
      );
    } catch (error) {
      if (!operation.current()) return;
      try {
        const recovered = await getPlayingTextAdventureSession(game.gameId, operation.signal);
        operation.assert();
        if (recovered) {
          queryClient.setQueryData(
            textAdventureSessionKeys.detail(game.gameId, locale, userId),
            recovered
          );
        } else {
          queryClient.setQueryData<TextGamePlaySession>(
            textAdventureSessionKeys.detail(game.gameId, locale, userId),
            (current) =>
              current
                ? {
                    ...current,
                    messages: current.messages.filter(
                      (item) =>
                        item.id !== optimisticId && item.id !== TEXT_GAME_STREAMING_ASSISTANT_ID
                    ),
                  }
                : current
          );
          setDraft(value);
        }
      } catch {
        if (!operation.current()) return;
        setDraft(value);
      }
      toast.error(errorMessage(error, t("playtest.sendFailed")));
    } finally {
      if (operation.current()) {
        sendingRef.current = false;
        setSending(false);
        window.requestAnimationFrame(() => {
          if (operation.current()) inputRef.current?.focus();
        });
      }
    }
  };

  const restart = async () => {
    if (!session || sendingRef.current || restartingRef.current) return;
    const operation = owner.begin();
    restartingRef.current = true;
    setRestarting(true);
    const toastId = toast.loading(t("playtest.restarting"));
    try {
      const next = await startTextAdventureSession(
        game.gameId,
        locale,
        {
          onSession: (sessionNext) => {
            if (!operation.current()) return;
            queryClient.setQueryData(
              textAdventureSessionKeys.detail(game.gameId, locale, userId),
              sessionNext
            );
          },
        },
        operation.signal
      );
      operation.assert();
      queryClient.setQueryData(textAdventureSessionKeys.detail(game.gameId, locale, userId), next);
      setDraft("");
      toast.success(t("playtest.restartComplete"), { id: toastId });
    } catch (error) {
      if (!operation.current()) {
        toast.dismiss(toastId);
        return;
      }
      toast.error(errorMessage(error, t("playtest.restartFailed")), { id: toastId });
    } finally {
      if (operation.current()) {
        restartingRef.current = false;
        setRestarting(false);
      }
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitAction();
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] bg-black/18">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 bg-white/[0.018] px-5 sm:px-7">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconMessageCircle className="size-4 shrink-0 text-white/48" stroke={1.7} />
            <h1 className="truncate text-sm font-semibold text-white/84">{t("playtest.title")}</h1>
          </div>
          {canPlay ? (
            <p className="mt-0.5 truncate pl-6 text-[11px] text-white/32">
              {session
                ? session.resumed
                  ? t("playtest.resumedSession")
                  : t("playtest.newSession")
                : t("playtest.liveVersion")}
            </p>
          ) : null}
        </div>

        {canPlay ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="quiet"
                size="sm"
                disabled={!session || sending || restarting}
                loading={restarting}
              >
                <IconRefresh data-icon="inline-start" />
                {t("playtest.restart")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("playtest.restartTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("playtest.restartBody")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel variant="quiet">{t("actions.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={() => void restart()}>
                  {t("playtest.restartConfirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </header>

      {!canPlay ? (
        <div className="grid min-h-0 flex-1 place-items-center px-6 py-12 text-center">
          <div className="max-w-sm">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-white/[0.045] text-white/34">
              <IconMessageCircle className="size-6" stroke={1.5} />
            </span>
            <h2 className="mt-5 text-lg font-semibold text-white/82">
              {t("playtest.unavailableTitle")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-white/38">{t("playtest.unavailableBody")}</p>
          </div>
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto px-5 pb-32 sm:px-8 lg:px-10"
          >
            <div className="mx-auto w-full max-w-[760px] py-8 sm:py-10">
              {hasUnpublishedDraft ? (
                <div className="mb-8 flex items-start gap-3 rounded-2xl bg-white/[0.035] px-4 py-3 text-xs leading-5 text-white/42">
                  <IconFileDescription
                    className="mt-0.5 size-4 shrink-0 text-white/46"
                    stroke={1.6}
                  />
                  <p>{t("playtest.draftNotice")}</p>
                </div>
              ) : null}

              {sessionQuery.isLoading && !session ? (
                <div className="flex flex-col items-center py-24 text-center">
                  <IconLoader2 className="size-6 animate-spin text-white/42" />
                  <p className="mt-4 text-sm text-white/40">{t("playtest.opening")}</p>
                </div>
              ) : null}

              {sessionQuery.isError ? (
                <div role="alert" className="rounded-2xl bg-destructive/[0.08] px-5 py-4">
                  <p className="text-sm font-semibold text-destructive">
                    {t("playtest.loadFailed")}
                  </p>
                  <p className="mt-1 break-words text-xs leading-5 text-white/48">
                    {sessionQuery.error instanceof Error
                      ? sessionQuery.error.message
                      : t("playtest.loadFailed")}
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="mt-4"
                    onClick={() => void sessionQuery.refetch()}
                  >
                    <IconRefresh data-icon="inline-start" />
                    {t("actions.retry")}
                  </Button>
                </div>
              ) : null}

              {session && messages.length === 0 ? (
                <div className="py-20 text-center">
                  <p className="text-base font-medium text-white/72">{t("playtest.emptyTitle")}</p>
                  <p className="mt-2 text-sm text-white/36">{t("playtest.emptyBody")}</p>
                </div>
              ) : null}

              <div className="space-y-10">
                {messages.map((message) => (
                  <TextAdventureMessage
                    key={message.id}
                    message={message}
                    actionLabel={t("playtest.yourAction")}
                    generatingLabel={t("playtest.responding")}
                  />
                ))}
                {sending && !streamingAssistant ? (
                  <div className="flex items-center gap-3 py-3 text-sm text-white/40">
                    <IconLoader2 className="size-4 animate-spin" />
                    {t("playtest.responding")}
                  </div>
                ) : null}
              </div>
              <div className="h-6" />
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-[#111214] via-[#111214]/96 to-transparent px-4 pt-10 pb-4 sm:px-7 sm:pb-5">
            <div className="pointer-events-auto mx-auto flex max-w-[760px] items-end gap-2 rounded-2xl bg-white/[0.075] p-2 shadow-2xl shadow-black/20">
              <textarea
                ref={inputRef}
                value={draft}
                rows={1}
                maxLength={2_000}
                disabled={!session || sending || restarting}
                placeholder={t("playtest.actionPlaceholder")}
                aria-label={t("playtest.actionPlaceholder")}
                className="field-sizing-content max-h-32 min-h-10 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm leading-5 text-white outline-none placeholder:text-white/28 disabled:opacity-50"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
              />
              <Button
                size="icon-lg"
                className="size-10 rounded-xl"
                disabled={!draft.trim() || !session || sending || restarting}
                loading={sending}
                onClick={() => void submitAction()}
                aria-label={t("playtest.send")}
              >
                <IconSend2 />
              </Button>
            </div>
            <p className="pointer-events-auto mx-auto mt-2 max-w-[760px] text-center text-[10px] text-white/22">
              {t("playtest.composerHint")}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function TextAdventureMessage({
  message,
  actionLabel,
  generatingLabel,
}: {
  message: TextGameMessage;
  actionLabel: string;
  generatingLabel: string;
}) {
  if (message.role === "system") {
    return <p className="text-center text-xs text-white/28">{message.content}</p>;
  }
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[82%] text-right">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/28">
          {actionLabel}
        </p>
        <p className="inline-block rounded-2xl rounded-tr-sm bg-white/[0.075] px-4 py-3 text-left text-sm leading-6 text-white/74">
          {message.content}
        </p>
      </div>
    );
  }
  return (
    <TextAdventureStreamBody
      content={message.content}
      streaming={message.id === TEXT_GAME_STREAMING_ASSISTANT_ID}
      generatingLabel={generatingLabel}
    />
  );
}

function AttachmentRow({
  icon: Icon,
  name,
  meta,
  actionLabel,
  actionIcon: ActionIcon,
  disabled,
  loading,
  onAction,
  removeLabel,
  onRemove,
}: {
  icon: typeof IconBook2;
  name: string;
  meta: string;
  actionLabel: string;
  actionIcon: typeof IconBook2;
  disabled: boolean;
  loading: boolean;
  onAction: () => void;
  removeLabel?: string;
  onRemove?: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl bg-white/[0.035] p-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.055] text-white/54">
        <Icon className="size-4" stroke={1.6} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-white/72" title={name}>
          {name}
        </p>
        <p className="mt-0.5 truncate text-[10px] text-white/30">{meta}</p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled}
        loading={loading}
        aria-label={actionLabel}
        onClick={onAction}
      >
        {loading ? null : <ActionIcon data-icon="inline-start" />}
        {actionLabel}
      </Button>
      {onRemove && removeLabel ? (
        <Button
          variant="quiet"
          size="icon-sm"
          disabled={disabled}
          aria-label={removeLabel}
          onClick={onRemove}
        >
          <IconTrash />
        </Button>
      ) : null}
    </div>
  );
}

function InspectorMenuButton({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: typeof IconBook2;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 text-left outline-none transition-colors hover:bg-white/[0.055] focus-visible:bg-white/[0.055] focus-visible:ring-2 focus-visible:ring-white/25"
    >
      <span className="grid size-8 shrink-0 place-items-center text-white/54">
        <Icon className="size-4" stroke={1.7} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/74">{label}</span>
      <span className="max-w-28 truncate text-[11px] text-white/32">{value}</span>
      <IconChevronRight className="size-4 shrink-0 text-white/26 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

function attachmentFileName(url: string | null, fallback: string): string {
  if (!url) return fallback;
  try {
    const path = new URL(url).pathname;
    const encodedName = path.split("/").filter(Boolean).at(-1);
    return encodedName
      ? readableAttachmentName(decodeURIComponent(encodedName), fallback)
      : fallback;
  } catch {
    const encodedName = url.split("?")[0].split("/").filter(Boolean).at(-1);
    if (!encodedName) return fallback;
    try {
      return readableAttachmentName(decodeURIComponent(encodedName), fallback);
    } catch {
      return readableAttachmentName(encodedName, fallback);
    }
  }
}

function readableAttachmentName(fileName: string, fallback: string): string {
  const opaqueFileName =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]+)?$/i;
  const match = fileName.match(opaqueFileName);
  if (!match) return fileName;
  const extension = match[1] ?? "";
  return extension && !fallback.toLowerCase().endsWith(extension.toLowerCase())
    ? `${fallback}${extension}`
    : fallback;
}

function formatAttachmentDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function TextAdventureWorkbenchSkeleton({ label }: { label?: string }) {
  return (
    <main
      className="flex min-h-dvh flex-col bg-[var(--canvas-background)] min-[1100px]:fixed min-[1100px]:inset-0 min-[1100px]:h-dvh min-[1100px]:overflow-hidden"
      aria-busy="true"
      aria-label={label}
    >
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 bg-black/10 px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-2" aria-hidden="true">
          <Skeleton className="size-9 shrink-0 rounded-xl bg-white/[0.045]" />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-40 bg-white/[0.06]" />
            <Skeleton className="h-2.5 w-24 bg-white/[0.035]" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3" aria-hidden="true">
          <Skeleton className="hidden h-3 w-14 bg-white/[0.035] sm:block" />
          <Skeleton className="h-9 w-14 rounded-xl bg-white/[0.045]" />
        </div>
      </div>

      <div className="grid min-h-[calc(100dvh-3.5rem)] flex-1 grid-cols-1 min-[1100px]:min-h-0 min-[1100px]:grid-cols-[minmax(0,1fr)_380px]">
        <section
          className="h-[calc(100dvh-3.5rem)] min-h-[620px] min-w-0 p-3 sm:p-5 min-[1100px]:h-full min-[1100px]:min-h-0 lg:p-6"
          aria-hidden="true"
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] bg-black/18">
            <div className="flex h-16 shrink-0 items-center justify-between bg-white/[0.018] px-5 sm:px-7">
              <div className="space-y-2">
                <Skeleton className="h-3.5 w-28 bg-white/[0.055]" />
                <Skeleton className="h-2.5 w-20 bg-white/[0.03]" />
              </div>
              <Skeleton className="h-7 w-24 rounded-lg bg-white/[0.045]" />
            </div>
            <div className="min-h-0 flex-1 px-5 py-10 sm:px-8 lg:px-10">
              <div className="mx-auto max-w-[760px] space-y-10">
                <div className="space-y-3">
                  <Skeleton className="h-3.5 w-full bg-white/[0.045]" />
                  <Skeleton className="h-3.5 w-[92%] bg-white/[0.04]" />
                  <Skeleton className="h-3.5 w-[76%] bg-white/[0.035]" />
                </div>
                <div className="ml-auto w-[58%] space-y-2">
                  <Skeleton className="ml-auto h-2.5 w-20 bg-white/[0.03]" />
                  <Skeleton className="h-16 w-full rounded-2xl bg-white/[0.055]" />
                </div>
                <div className="space-y-3">
                  <Skeleton className="h-3.5 w-[96%] bg-white/[0.045]" />
                  <Skeleton className="h-3.5 w-[84%] bg-white/[0.04]" />
                  <Skeleton className="h-3.5 w-[68%] bg-white/[0.035]" />
                </div>
              </div>
            </div>
            <div className="shrink-0 px-4 pb-5 sm:px-7">
              <Skeleton className="mx-auto h-14 max-w-[760px] rounded-2xl bg-white/[0.06]" />
            </div>
          </div>
        </section>

        <aside
          className="min-w-0 bg-black/12 px-4 py-5 sm:px-6 min-[1100px]:h-full min-[1100px]:overflow-hidden"
          aria-hidden="true"
        >
          <SkeletonInspectorSection titleWidth="w-24">
            <div className="space-y-2">
              <Skeleton className="h-2.5 w-10 bg-white/[0.035]" />
              <Skeleton className="h-11 w-full rounded-xl bg-white/[0.045]" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-2.5 w-16 bg-white/[0.035]" />
              <Skeleton className="h-24 w-full rounded-xl bg-white/[0.045]" />
            </div>
          </SkeletonInspectorSection>

          <SkeletonInspectorSection titleWidth="w-14">
            <Skeleton className="mx-auto aspect-[2/3] w-full max-w-[220px] rounded-2xl bg-white/[0.04]" />
            <Skeleton className="h-2.5 w-[84%] bg-white/[0.03]" />
            <Skeleton className="h-9 w-full rounded-xl bg-white/[0.05]" />
          </SkeletonInspectorSection>

          <SkeletonInspectorSection titleWidth="w-36">
            <div className="flex items-center gap-3 rounded-2xl bg-white/[0.035] p-3">
              <Skeleton className="size-10 shrink-0 rounded-xl bg-white/[0.06]" />
              <div className="w-full space-y-2">
                <Skeleton className="h-3 w-4/5 bg-white/[0.055]" />
                <Skeleton className="h-2.5 w-2/5 bg-white/[0.03]" />
              </div>
            </div>
            <Skeleton className="h-9 w-full rounded-xl bg-white/[0.05]" />
            <Skeleton className="h-2.5 w-[92%] bg-white/[0.03]" />
          </SkeletonInspectorSection>

          <SkeletonInspectorSection titleWidth="w-28">
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, index) => (
                <SkeletonCharacterCard key={index} compact index={index} />
              ))}
            </div>
          </SkeletonInspectorSection>
        </aside>
      </div>
      {label ? <span className="sr-only">{label}</span> : null}
    </main>
  );
}

function SkeletonInspectorSection({
  titleWidth,
  children,
}: {
  titleWidth: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <div className="mb-3 flex items-center gap-2">
        <Skeleton className="size-4 rounded bg-white/[0.04]" />
        <Skeleton className={`h-3 bg-white/[0.045] ${titleWidth}`} />
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function SkeletonCharacterCard({ compact = false, index }: { compact?: boolean; index: number }) {
  const titleWidths = ["w-20", "w-28", "w-16", "w-24"];
  const descriptionWidths = ["w-[92%]", "w-[78%]", "w-[86%]", "w-[70%]"];

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl bg-white/[0.025] p-3">
      <Skeleton
        className={`${compact ? "size-10" : "size-12"} shrink-0 rounded-full bg-white/[0.055]`}
      />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className={`h-3 bg-white/[0.055] ${titleWidths[index % titleWidths.length]}`} />
        <Skeleton
          className={`h-2.5 bg-white/[0.03] ${descriptionWidths[index % descriptionWidths.length]}`}
        />
        {!compact ? <Skeleton className="h-2.5 w-3/5 bg-white/[0.025]" /> : null}
      </div>
    </div>
  );
}
