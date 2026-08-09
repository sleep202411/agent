/* eslint-disable @next/next/no-img-element -- creator-provided CDN URLs are dynamic */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBook2,
  IconCheck,
  IconExternalLink,
  IconFileDescription,
  IconFileTypeDocx,
  IconMusic,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  isTextGameCreatorActionAllowed,
  isTextGameEditableByCreator,
  type TextGameCreatorAction,
  type TextGameDetail,
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
  getCreatorTextGame,
  textGameKeys,
  transitionCreatorTextGame,
  updateCreatorTextGame,
} from "../_lib/text-game-api";
import {
  textGameDraftFormFromDetail,
  toTextGameUpdateInput,
  type TextGameDraftForm,
} from "../_lib/text-game-draft";

type UploadTarget = "poster" | "document" | "stills" | "bgm" | null;

export function TextGameWorkbench({ gameId }: { gameId: string }) {
  const t = useTranslations("textGames");
  const query = useQuery({
    queryKey: textGameKeys.detail(gameId),
    queryFn: () => getCreatorTextGame(gameId),
  });

  if (query.isLoading) return <TextGameWorkbenchSkeleton />;
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

  return (
    <LoadedWorkbench key={`${query.data.gameId}:${query.data.updatedAt}`} initial={query.data} />
  );
}

function LoadedWorkbench({ initial }: { initial: TextGameDetail }) {
  const t = useTranslations("textGames");
  const locale = useLocale();
  const region = useSiteRegion();
  const queryClient = useQueryClient();
  const posterInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const stillInputRef = useRef<HTMLInputElement>(null);
  const [game, setGame] = useState(initial);
  const [form, setForm] = useState<TextGameDraftForm>(() => textGameDraftFormFromDetail(initial));
  const [baseline, setBaseline] = useState<TextGameDraftForm>(() =>
    textGameDraftFormFromDetail(initial)
  );
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<UploadTarget>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const editable = isTextGameEditableByCreator(game.status);
  const editorBusy = saving || transitioning || uploadTarget !== null;
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [form, baseline]);
  const requiredReady = Boolean(
    form.name.trim() && form.synopsis.trim() && form.posterUrl && form.worldviewDocxUrl
  );
  const hasUnpublishedDraft =
    game.publishedVersionId !== null && game.draftVersionId !== game.publishedVersionId;

  useEffect(() => {
    if (!dirty && !saving && !transitioning && uploadTarget === null) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty, saving, transitioning, uploadTarget]);

  const syncGame = (next: TextGameDetail) => {
    const nextForm = textGameDraftFormFromDetail(next);
    setGame(next);
    setForm(nextForm);
    setBaseline(nextForm);
    queryClient.setQueryData(textGameKeys.detail(next.gameId), next);
    void queryClient.invalidateQueries({ queryKey: textGameKeys.list() });
  };

  const saveForm = async (
    patch: Partial<TextGameDraftForm> = {},
    successMessage: string | null = t("editor.saved")
  ): Promise<TextGameDetail> => {
    const nextForm = { ...form, ...patch };
    setSaving(true);
    try {
      const next = await updateCreatorTextGame(
        game.gameId,
        toTextGameUpdateInput(nextForm, baseline)
      );
      syncGame(next);
      if (successMessage) toast.success(successMessage);
      return next;
    } finally {
      setSaving(false);
    }
  };

  const saveWithFeedback = async (patch: Partial<TextGameDraftForm> = {}) => {
    try {
      await saveForm(patch);
    } catch (error) {
      toast.error(errorMessage(error, t("actions.unknownError")));
    }
  };

  const uploadOne = async (
    target: Exclude<UploadTarget, null>,
    file: File,
    kind: "episode_cover" | "agent_attachment_document" | "ai_reference_image" | "story_music_audio"
  ): Promise<string> => {
    setUploadTarget(target);
    setUploadProgress(0);
    try {
      const result = await uploadFileViaSignedUrl(file, {
        kind,
        onProgress: setUploadProgress,
      });
      return result.url;
    } finally {
      setUploadTarget(null);
      setUploadProgress(0);
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
      toast.error(errorMessage(error, t("actions.unknownError")));
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
      toast.error(errorMessage(error, t("actions.unknownError")));
    }
  };

  const uploadStills = async (files: File[]) => {
    if (files.length === 0) return;
    if (files.some((file) => !file.type.startsWith("image/"))) {
      toast.error(t("editor.stillsImageOnly"));
      return;
    }
    setUploadTarget("stills");
    try {
      const urls: string[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const result = await uploadFileViaSignedUrl(files[index], {
          kind: "ai_reference_image",
          onProgress: (value) =>
            setUploadProgress(Math.round(((index + value / 100) / files.length) * 100)),
        });
        urls.push(result.url);
      }
      await saveForm({ stillUrls: [...form.stillUrls, ...urls] });
    } catch (error) {
      toast.error(errorMessage(error, t("actions.unknownError")));
    } finally {
      setUploadTarget(null);
      setUploadProgress(0);
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
      toast.error(errorMessage(error, t("actions.unknownError")));
    }
  };

  const transition = async (action: TextGameCreatorAction) => {
    if (!isTextGameCreatorActionAllowed(game.status, action)) return;
    setTransitioning(true);
    try {
      let current = game;
      if (dirty && editable) current = await saveForm({}, null);
      const next = await transitionCreatorTextGame(current.gameId, action);
      syncGame(next);
      toast.success(action === "submit" ? t("publish.submitted") : t("publish.offlined"));
    } catch (error) {
      toast.error(errorMessage(error, t("actions.unknownError")));
    } finally {
      setTransitioning(false);
    }
  };

  const publicUrl = `${getWebBaseUrl(region)}/${locale}/play/text-game/${encodeURIComponent(game.gameId)}`;

  return (
    <main className="flex min-h-dvh flex-col bg-[var(--canvas-background)] min-[1100px]:h-dvh min-[1100px]:overflow-hidden">
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 bg-black/10 px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Button asChild variant="quiet" size="icon" aria-label={t("actions.backToLibrary")}>
            <Link href="/text-games">
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
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden items-center gap-1.5 text-xs text-white/35 sm:inline-flex">
            {dirty ? null : <IconCheck className="size-3.5" stroke={1.8} />}
            {dirty ? t("editor.unsaved") : t("editor.saved")}
          </span>
          <Button
            variant="secondary"
            disabled={!editable || !dirty || editorBusy}
            loading={saving}
            onClick={() => void saveWithFeedback()}
          >
            {t("actions.save")}
          </Button>
        </div>
      </div>

      <div className="grid min-h-[calc(100dvh-3.5rem)] flex-1 grid-cols-1 min-[1100px]:min-h-0 min-[1100px]:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-h-0 min-w-0 p-3 sm:p-5 lg:p-6">
          <TextGameDraftPreview form={form} characters={game.content.characters} />
        </section>

        <aside className="min-w-0 bg-black/12 px-4 py-5 sm:px-6 min-[1100px]:h-full min-[1100px]:overflow-y-auto">
          {!editable ? (
            <FrostedPanel className="mb-5 flex items-start gap-3 p-4">
              <IconFileDescription className="mt-0.5 size-5 shrink-0 text-white/55" stroke={1.6} />
              <div>
                <p className="text-sm font-medium">{t("editor.reviewLockedTitle")}</p>
                <p className="mt-1 text-xs leading-5 text-white/40">
                  {t("editor.reviewLockedBody")}
                </p>
              </div>
            </FrostedPanel>
          ) : null}

          {game.rejectReason ? (
            <FrostedPanel className="mb-5 bg-destructive/[0.08] p-4" role="alert">
              <p className="text-xs font-semibold uppercase tracking-[0.09em] text-destructive">
                {t("publish.rejected")}
              </p>
              <p className="mt-2 text-sm leading-6 text-white/68">{game.rejectReason}</p>
            </FrostedPanel>
          ) : null}

          <InspectorSection icon={IconBook2} title={t("editor.sections.basics")}>
            <Field label={t("editor.name")} htmlFor="text-game-name" required dense>
              <Input
                id="text-game-name"
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
            <Field label={t("editor.synopsis")} htmlFor="text-game-synopsis" required dense>
              <Textarea
                id="text-game-synopsis"
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
          </InspectorSection>

          <InspectorSection icon={IconPhoto} title={t("editor.sections.poster")}>
            <input
              ref={posterInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label={form.posterUrl ? t("editor.replacePoster") : t("editor.uploadPoster")}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadPoster(file);
                event.target.value = "";
              }}
            />
            {form.posterUrl ? (
              <div className="mx-auto aspect-[2/3] w-full max-w-[220px] overflow-hidden rounded-2xl bg-white/[0.04]">
                <img src={form.posterUrl} alt="" className="size-full object-cover" />
              </div>
            ) : (
              <div className="mx-auto grid aspect-[2/3] w-full max-w-[220px] place-items-center rounded-2xl bg-white/[0.04] text-white/18">
                <IconPhoto className="size-10" stroke={1.3} />
              </div>
            )}
            <p className="text-[11px] leading-5 text-white/30">{t("editor.posterHint")}</p>
            <Button
              block
              variant="secondary"
              disabled={!editable || editorBusy}
              loading={uploadTarget === "poster"}
              onClick={() => posterInputRef.current?.click()}
            >
              <IconPhoto data-icon="inline-start" />
              {form.posterUrl ? t("editor.replacePoster") : t("editor.uploadPoster")}
            </Button>
          </InspectorSection>

          <InspectorSection icon={IconFileTypeDocx} title={t("editor.sections.worldview")}>
            <input
              ref={documentInputRef}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              aria-label={t("editor.replaceDocument")}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void replaceDocument(file);
                event.target.value = "";
              }}
            />
            <div className="flex items-center gap-3 rounded-2xl bg-white/[0.045] p-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/62">
                <IconFileTypeDocx className="size-5" stroke={1.5} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white/78">
                  {t("editor.worldviewAttached")}
                </p>
                <p className="mt-0.5 text-[11px] text-white/32">
                  {t("editor.charactersFound", { count: game.content.characters.length })}
                </p>
              </div>
            </div>
            <Button
              block
              variant="secondary"
              disabled={!editable || editorBusy}
              loading={uploadTarget === "document" || saving}
              onClick={() => documentInputRef.current?.click()}
            >
              <IconRefresh data-icon="inline-start" />
              {uploadTarget === "document" ? t("editor.reanalyzing") : t("editor.replaceDocument")}
            </Button>
            <p className="text-[11px] leading-5 text-white/30">{t("editor.replaceDocumentHint")}</p>
          </InspectorSection>

          <InspectorSection icon={IconUsers} title={t("editor.sections.characters")}>
            {game.content.characters.length === 0 ? (
              <p className="rounded-2xl bg-white/[0.035] px-4 py-5 text-center text-xs leading-5 text-white/35">
                {t("editor.noCharacters")}
              </p>
            ) : (
              <div className="space-y-2">
                {game.content.characters
                  .slice()
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((character) => (
                    <div
                      key={character.id}
                      className="flex items-center gap-3 rounded-2xl bg-white/[0.035] p-3"
                    >
                      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-white/[0.06] text-white/40">
                        {character.avatarUrl ? (
                          <img
                            src={character.avatarUrl}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : (
                          <IconUser className="size-5" stroke={1.5} />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white/78">
                          {character.name}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-white/36">
                          {character.intro}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            )}
            <p className="text-[11px] leading-5 text-white/30">{t("editor.charactersReadOnly")}</p>
          </InspectorSection>

          <InspectorSection icon={IconPhoto} title={t("editor.sections.stills")}>
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
                            stillUrls: form.stillUrls.filter((_, candidate) => candidate !== index),
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
          </InspectorSection>

          <InspectorSection icon={IconMusic} title={t("editor.sections.music")}>
            {form.bgmUrl ? (
              <audio controls src={form.bgmUrl} className="h-10 w-full" />
            ) : (
              <p className="rounded-2xl bg-white/[0.035] px-4 py-5 text-center text-xs text-white/35">
                {t("editor.noMusic")}
              </p>
            )}
            <div className="relative rounded-xl focus-within:ring-2 focus-within:ring-ring/30">
              <input
                type="file"
                accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
                aria-label={form.bgmUrl ? t("editor.replaceMusic") : t("editor.uploadMusic")}
                className="absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:pointer-events-none disabled:cursor-not-allowed"
                disabled={!editable || editorBusy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadBgm(file);
                  event.target.value = "";
                }}
              />
              <Button
                block
                variant="secondary"
                disabled={!editable || editorBusy}
                loading={uploadTarget === "bgm"}
                tabIndex={-1}
                aria-hidden="true"
                className="pointer-events-none"
              >
                <IconMusic data-icon="inline-start" />
                {form.bgmUrl ? t("editor.replaceMusic") : t("editor.uploadMusic")}
              </Button>
            </div>
            {form.bgmUrl && editable ? (
              <Button
                block
                variant="quiet"
                disabled={editorBusy}
                onClick={() => void saveWithFeedback({ bgmUrl: "" })}
              >
                <IconTrash data-icon="inline-start" />
                {t("editor.removeMusic")}
              </Button>
            ) : null}
          </InspectorSection>

          <InspectorSection icon={IconCheck} title={t("editor.sections.publish")}>
            <div className="space-y-2 rounded-2xl bg-white/[0.035] p-4">
              <Requirement
                ready={Boolean(form.name.trim())}
                label={t("publish.requirements.name")}
              />
              <Requirement
                ready={Boolean(form.posterUrl)}
                label={t("publish.requirements.poster")}
              />
              <Requirement
                ready={Boolean(form.synopsis.trim())}
                label={t("publish.requirements.synopsis")}
              />
              <Requirement
                ready={Boolean(form.worldviewDocxUrl)}
                label={t("publish.requirements.document")}
              />
            </div>

            {hasUnpublishedDraft ? (
              <p className="text-xs leading-5 text-white/42">{t("publish.onlineUnaffected")}</p>
            ) : null}

            {game.status === "published" ? (
              <Button asChild block variant="quiet">
                <a href={publicUrl} target="_blank" rel="noreferrer">
                  <IconExternalLink data-icon="inline-start" />
                  {t("publish.viewLive")}
                </a>
              </Button>
            ) : null}

            {isTextGameCreatorActionAllowed(game.status, "submit") ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    block
                    variant="primary-cta"
                    size="lg"
                    disabled={!requiredReady || editorBusy}
                  >
                    {game.status === "published" ? t("publish.submitUpdate") : t("publish.submit")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
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
                </AlertDialogContent>
              </AlertDialog>
            ) : null}

            {isTextGameCreatorActionAllowed(game.status, "offline") ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button block variant="destructive" disabled={editorBusy}>
                    {t("publish.takeOffline")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("publish.offlineConfirmTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("publish.offlineConfirmBody")}
                    </AlertDialogDescription>
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
          </InspectorSection>
        </aside>
      </div>
    </main>
  );
}

function TextGameDraftPreview({
  form,
  characters,
}: {
  form: TextGameDraftForm;
  characters: TextGameDetail["content"]["characters"];
}) {
  const t = useTranslations("textGames");
  const name = form.name.trim() || t("library.untitled");
  const sortedCharacters = characters.slice().sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="h-full min-h-[680px] overflow-y-auto rounded-[24px] bg-black/18 min-[1100px]:min-h-0">
      <div className="mx-auto w-full max-w-4xl px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/34">
          {t("preview.eyebrow")}
        </p>

        <div className="mt-5 grid gap-6 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-end sm:gap-8">
          <div className="relative aspect-[2/3] w-full max-w-[220px] overflow-hidden rounded-[22px] bg-white/[0.04]">
            {form.posterUrl ? (
              <img
                src={form.posterUrl}
                alt={t("preview.posterAlt", { name })}
                className="size-full object-cover"
              />
            ) : (
              <div className="grid size-full place-items-center text-white/16">
                <IconPhoto className="size-14" stroke={1.15} />
              </div>
            )}
          </div>
          <div className="min-w-0 pb-1">
            <h1 className="text-2xl font-semibold tracking-[-0.025em] text-white sm:text-4xl">
              {name}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/56 sm:text-base">
              {form.synopsis.trim() || t("preview.synopsisFallback")}
            </p>
          </div>
        </div>

        <section className="mt-9">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-white/30">
                {t("preview.castEyebrow")}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-white/88">{t("preview.castTitle")}</h2>
            </div>
            <p className="text-xs text-white/32">
              {t("preview.castCount", { count: sortedCharacters.length })}
            </p>
          </div>

          {sortedCharacters.length > 0 ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {sortedCharacters.map((character) => (
                <article
                  key={character.id}
                  className="flex min-w-0 items-center gap-3 rounded-2xl bg-white/[0.035] p-3"
                >
                  <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-white/[0.06] text-white/38">
                    {character.avatarUrl ? (
                      <img
                        src={character.avatarUrl}
                        alt={character.name}
                        className="size-full object-cover"
                      />
                    ) : (
                      <IconUser className="size-5" stroke={1.5} />
                    )}
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium text-white/78">{character.name}</h3>
                    <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-white/38">
                      {character.intro}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl bg-white/[0.03] px-5 py-8 text-center">
              <IconUsers className="mx-auto size-7 text-white/20" stroke={1.4} />
              <p className="mx-auto mt-3 max-w-md text-xs leading-5 text-white/36">
                {t("preview.noCast")}
              </p>
            </div>
          )}
        </section>

        {form.stillUrls.length > 0 ? (
          <section className="mt-9">
            <h2 className="text-sm font-semibold text-white/72">{t("preview.stillsTitle")}</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {form.stillUrls.slice(0, 6).map((url, index) => (
                <img
                  key={`${url}:${index}`}
                  src={url}
                  alt={t("preview.stillAlt", { index: index + 1 })}
                  className="aspect-video w-full rounded-xl object-cover"
                />
              ))}
            </div>
          </section>
        ) : null}

        <FrostedPanel className="mt-9 flex items-start gap-3 p-4">
          <IconBook2 className="mt-0.5 size-5 shrink-0 text-white/52" stroke={1.6} />
          <p className="text-xs leading-5 text-white/42">{t("preview.notice")}</p>
        </FrostedPanel>
      </div>
    </div>
  );
}

function InspectorSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof IconBook2;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <div className="mb-3 flex items-center gap-2 text-white/62">
        <Icon className="size-4" stroke={1.7} />
        <h2 className="text-xs font-semibold uppercase tracking-[0.09em]">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Requirement({ ready, label }: { ready: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={
          ready
            ? "grid size-5 place-items-center rounded-md bg-white/[0.08] text-white/72"
            : "grid size-5 place-items-center rounded-md bg-white/[0.04] text-white/20"
        }
      >
        <IconCheck className="size-3.5" stroke={2} />
      </span>
      <span className={ready ? "text-white/62" : "text-white/30"}>{label}</span>
    </div>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function TextGameWorkbenchSkeleton({ label }: { label?: string }) {
  return (
    <main
      className="flex min-h-dvh flex-col bg-[var(--canvas-background)] min-[1100px]:h-dvh min-[1100px]:overflow-hidden"
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

      <div className="grid min-h-[calc(100dvh-3.5rem)] flex-1 grid-cols-1 min-[1100px]:min-h-0 min-[1100px]:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-h-0 min-w-0 p-3 sm:p-5 lg:p-6" aria-hidden="true">
          <div className="h-full min-h-[680px] overflow-hidden rounded-[24px] bg-black/18 min-[1100px]:min-h-0">
            <div className="mx-auto w-full max-w-4xl px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
              <Skeleton className="h-3 w-24 bg-white/[0.045]" />

              <div className="mt-5 grid gap-6 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-end sm:gap-8">
                <Skeleton className="aspect-[2/3] w-full max-w-[220px] rounded-[22px] bg-white/[0.04]" />
                <div className="space-y-4 pb-1">
                  <Skeleton className="h-9 w-[64%] min-w-48 bg-white/[0.08]" />
                  <div className="space-y-2.5">
                    <Skeleton className="h-3.5 w-[88%] bg-white/[0.05]" />
                    <Skeleton className="h-3.5 w-[64%] bg-white/[0.04]" />
                  </div>
                </div>
              </div>

              <section className="mt-9">
                <div className="flex items-end justify-between gap-4">
                  <div className="space-y-2">
                    <Skeleton className="h-2.5 w-36 bg-white/[0.035]" />
                    <Skeleton className="h-5 w-28 bg-white/[0.055]" />
                  </div>
                  <Skeleton className="h-2.5 w-16 bg-white/[0.035]" />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {Array.from({ length: 8 }, (_, index) => (
                    <SkeletonCharacterCard key={index} index={index} />
                  ))}
                </div>
              </section>

              <div className="mt-9 flex items-start gap-3 rounded-2xl bg-white/[0.025] p-4">
                <Skeleton className="size-5 shrink-0 rounded-md bg-white/[0.045]" />
                <div className="w-full space-y-2">
                  <Skeleton className="h-2.5 w-full bg-white/[0.04]" />
                  <Skeleton className="h-2.5 w-3/4 bg-white/[0.03]" />
                </div>
              </div>
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
