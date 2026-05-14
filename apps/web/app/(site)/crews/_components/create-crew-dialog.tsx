"use client";

/**
 * Create-crew dialog. Phase-1 spec entry — opens from the `/crews`
 * hero CTA. Visually mirrors `<CreateIPDialog>` so the two creation
 * flows feel like one product (see `DESIGN.md` § "Create dialog
 * conventions" for the full pattern).
 *
 * Fields (matching `POST /project/crew/create`):
 *   - 名称 / name         — required
 *   - 描述 / description  — required
 *   - 封面图 / banner     — required, image upload
 *
 * Cover-video upload was removed pending a proper presigned-URL
 * endpoint for crew videos — the previous shortcut piped video bytes
 * through `/project/uploadBanner`, which works only because backend
 * skips file-type validation. Add the field back once the endpoint
 * lands; backend still accepts a `video` path on the wire.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconLoader2, IconPhoto } from "@tabler/icons-react";
import { toast } from "sonner";
import posthog from "posthog-js";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHero,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ApiRequestError } from "@/src/lib/api";
import { uploadBanner } from "@/src/services/user";
import { env } from "@/src/env";
import { cn } from "@/lib/utils";
import { useCreateCrew, useUpdateCrew } from "@/app/(site)/crews/_hooks/use-crew";

// Hero image — same static CDN we use for `<CreateIPDialog>`. Replace
// when product gives a crew-specific illustration.
const CREATE_CREW_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月28日 20_51_09.png"
);

/**
 * `initial` is the gate for edit mode. When present, dialog prefills
 * from it on open and routes submit through `updateCrew` instead of
 * `createCrew`. Absent → original create flow, unchanged.
 */
export interface CrewFormInitial {
  id: number | string;
  name: string;
  description?: string;
  banner?: string;
}

interface CreateCrewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: CrewFormInitial | null;
}

export function CreateCrewDialog({ open, onOpenChange, initial }: CreateCrewDialogProps) {
  const t = useTranslations("crew");
  const tc = useTranslations("common");
  const router = useRouter();
  const locale = useLocale() as Locale;

  const isEdit = !!initial;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // Backend persists a relative OSS key in `banner`; we keep both the
  // raw key (sent on submit) and rely on env.BANNER_BASE_URL to render
  // the preview locally.
  const [bannerLink, setBannerLink] = useState("");
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const create = useCreateCrew();
  const update = useUpdateCrew();
  // Kept named `creating` in body so the existing JSX still reads
  // naturally — in edit mode this just means "update in flight".
  const creating = create.isPending || update.isPending;

  // Reset / prefill on open. Edit mode hydrates from `initial`; close
  // clears so a previous failed attempt doesn't leak into the next open.
  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
      setBannerLink("");
      setUploadingBanner(false);
      return;
    }
    if (initial) {
      setName(initial.name ?? "");
      setDescription(initial.description ?? "");
      setBannerLink(initial.banner ?? "");
    }
  }, [open, initial]);

  // ─── Banner upload (image) ─────────────────────────
  const handleBannerFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(t("createBannerImageOnly"));
      return;
    }
    setUploadingBanner(true);
    try {
      const path = await uploadBanner(file);
      if (typeof path !== "string" || path.length === 0) {
        throw new Error("upload returned empty path");
      }
      setBannerLink(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg || t("createBannerUploadFailed"));
    } finally {
      setUploadingBanner(false);
    }
  };

  // Shared error handler — both flows surface the raw backend response
  // so a hidden 401 / 422 isn't masked behind a generic toast (platform
  // error convention — see DESIGN.md § "Error toasts").
  const reportError = (err: unknown, fallbackKey: "createFailed" | "updateFailed") => {
    if (err instanceof ApiRequestError) {
      const detail = err.responseBody?.slice(0, 800) || err.message;
      toast.error(`HTTP ${err.status}`, { description: detail, duration: 10000 });
    } else {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg || t(fallbackKey));
    }
  };

  // ─── Submit ─────────────────────────────────────────
  const handleSubmit = () => {
    if (!name.trim() || !description.trim() || !bannerLink || creating) return;

    if (isEdit && initial) {
      update.mutate(
        {
          id: String(initial.id),
          name: name.trim(),
          banner: bannerLink,
          description: description.trim(),
        },
        {
          onSuccess: () => {
            onOpenChange(false);
            toast.success(t("updateSuccess"));
          },
          onError: (err) => reportError(err, "updateFailed"),
        }
      );
      return;
    }

    create.mutate(
      {
        name: name.trim(),
        banner: bannerLink,
        description: description.trim(),
      },
      {
        onSuccess: ({ id }) => {
          posthog.capture("crew_created", { crew_id: id });
          onOpenChange(false);
          toast.success(t("createSuccess"));
          router.push(localizePath(`/crews/${id}/workspace`, locale));
        },
        onError: (err) => {
          posthog.captureException(err);
          reportError(err, "createFailed");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHero
          src={CREATE_CREW_HERO_URL}
          eyebrow={t("createDialogEyebrow")}
          title={isEdit ? t("editDialogTitle") : t("createDialogTitle")}
          description={isEdit ? t("editDialogSubtitle") : t("createDialogSubtitle")}
        />

        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel required>{t("createNameLabel")}</FieldLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("createNamePlaceholder")}
                maxLength={60}
              />
            </Field>

            <Field>
              <FieldLabel required>{t("createDescriptionLabel")}</FieldLabel>
              <Textarea
                // Cap height so a long description doesn't push the
                // submit button out of the dialog. Auto-grow stops at
                // max-h and the textarea's own scrollbar takes over.
                className="max-h-40 overflow-y-auto"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("createDescriptionPlaceholder")}
                maxLength={500}
                rows={3}
              />
            </Field>

            <Field>
              <FieldLabel required>{t("createBannerLabel")}</FieldLabel>
              <button
                type="button"
                onClick={() => bannerInputRef.current?.click()}
                disabled={uploadingBanner}
                className={cn(
                  "relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted/30 transition-colors hover:border-primary/50",
                  uploadingBanner && "cursor-wait opacity-60"
                )}
              >
                {bannerLink ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={
                      bannerLink.startsWith("http")
                        ? bannerLink
                        : `${env.BANNER_BASE_URL}/${bannerLink}`
                    }
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-1.5 text-xs text-muted-foreground">
                    {uploadingBanner ? (
                      <IconLoader2 className="size-5 animate-spin" />
                    ) : (
                      <IconPhoto className="size-5" />
                    )}
                    <span>{t("createBannerPickHint")}</span>
                  </div>
                )}
              </button>
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleBannerFile(file);
                }}
              />
            </Field>
          </FieldGroup>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            {tc("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={
              !name.trim() || !description.trim() || !bannerLink || uploadingBanner || creating
            }
          >
            {creating ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {isEdit
              ? creating
                ? t("editSubmitting")
                : t("editSubmit")
              : creating
                ? t("createSubmitting")
                : t("createSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
