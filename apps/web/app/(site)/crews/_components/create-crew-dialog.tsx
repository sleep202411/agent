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
 *   - logo               — required, square image upload (cropped to
 *                          circle in every consuming surface)
 *
 * The older `cover` / `coverVideo` fields were dropped in the
 * `crew_logo_and_showcase` migration — hero visuals on the detail
 * page now come from `showcaseWorks[0]` (or an enlarged-logo
 * gradient fallback). Tagline / genres / styles / socialLinks /
 * showcaseWorks are edited in the workspace 基本信息 tab (Phase B).
 */

import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
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
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { uploadBanner } from "@/src/services/user";
import { env } from "@/src/env";
import { cn } from "@/lib/utils";
import {
  crewApi,
  CrewApiError,
  useCreateCrew,
  useUpdateCrew,
} from "@/app/(site)/crews/_hooks/use-crew";
import { CrewEligibilityNotice } from "./crew-eligibility-notice";

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
  id: string;
  name: string;
  description?: string;
  /** OSS path of the crew logo (square). */
  logo?: string;
}

interface CreateCrewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: CrewFormInitial | null;
}

export function CreateCrewDialog(props: CreateCrewDialogProps) {
  const t = useTranslations("crew.creationRequirements");
  const eligibility = useQuery({
    queryKey: ["crew-creation-eligibility"],
    queryFn: () => crewApi.get<{ eligible: boolean }>("/crews/creation-eligibility"),
    enabled: props.open && !props.initial,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (!props.open) return null;
  if (props.initial) return <CrewFormDialog key={props.initial.id} {...props} />;
  if (eligibility.isPending || eligibility.isFetching || eligibility.isError) {
    return (
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {eligibility.isError ? eligibility.error.message : t("checking")}
          </DialogDescription>
          {eligibility.isError && (
            <Button onClick={() => void eligibility.refetch()}>{t("retry")}</Button>
          )}
        </DialogContent>
      </Dialog>
    );
  }
  if (eligibility.data?.eligible !== true)
    return <CrewEligibilityNotice open={props.open} onOpenChange={props.onOpenChange} />;
  return <CrewFormDialog {...props} onCertificationRequired={() => void eligibility.refetch()} />;
}

function CrewFormDialog({
  open,
  onOpenChange,
  initial,
  onCertificationRequired,
}: CreateCrewDialogProps & { onCertificationRequired?: () => void }) {
  const t = useTranslations("crew");
  const tc = useTranslations("common");
  const router = useRouter();
  const locale = useLocale() as Locale;

  const isEdit = !!initial;
  const [requirementsOpen, setRequirementsOpen] = useState(false);

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  // Backend persists a relative OSS key in `logo`; we keep both the
  // raw key (sent on submit) and rely on env.BANNER_BASE_URL to render
  // the local preview.
  const [logoPath, setLogoPath] = useState(initial?.logo ?? "");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const create = useCreateCrew();
  const update = useUpdateCrew();
  // Kept named `creating` in body so the existing JSX still reads
  // naturally — in edit mode this just means "update in flight".
  const creating = create.isPending || update.isPending;

  // ─── Logo upload (image) ──────────────────────────
  const handleLogoFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(t("createLogoImageOnly"));
      return;
    }
    setUploadingLogo(true);
    try {
      const path = await uploadBanner(file);
      if (typeof path !== "string" || path.length === 0) {
        throw new Error("upload returned empty path");
      }
      setLogoPath(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg || t("createLogoUploadFailed"));
    } finally {
      setUploadingLogo(false);
    }
  };

  // Shared error handler — both flows surface the raw backend response
  // so a hidden 401 / 422 isn't masked behind a generic toast (platform
  // error convention — see DESIGN.md § "Error toasts").
  const reportError = (err: unknown, fallbackKey: "createFailed" | "updateFailed") => {
    if (err instanceof CrewApiError) {
      const body =
        typeof err.body === "object" && err.body && "message" in err.body
          ? String((err.body as { message: unknown }).message)
          : typeof err.body === "string"
            ? err.body.slice(0, 800)
            : err.message;
      toast.error(`HTTP ${err.status}`, { description: body, duration: 10000 });
    } else {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg || t(fallbackKey));
    }
  };

  // ─── Submit ─────────────────────────────────────────
  const handleSubmit = () => {
    if (!name.trim() || !description.trim() || !logoPath || creating) return;

    if (isEdit && initial) {
      update.mutate(
        {
          id: String(initial.id),
          name: name.trim(),
          logo: logoPath,
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
        logo: logoPath,
        description: description.trim(),
        productionTemplateLocale: locale,
      },
      {
        onSuccess: (crew) => {
          posthog.capture("crew_created", { crew_id: crew.id });
          onOpenChange(false);
          toast.success(t("createSuccess"));
          router.push(localizePath(`/crews/${crew.id}/workspace`, locale));
        },
        onError: (err) => {
          if (
            err instanceof CrewApiError &&
            err.status === 403 &&
            (err.body as { code?: string } | null)?.code === "CREW_PRODUCER_CERTIFICATION_REQUIRED"
          ) {
            onCertificationRequired?.();
            return;
          }
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
          {!isEdit && (
            <>
              <button
                type="button"
                className="mb-4 text-sm underline underline-offset-4 focus-visible:outline focus-visible:outline-2"
                onClick={() => setRequirementsOpen(true)}
              >
                {t("creationRequirements.title")}
              </button>
              <CrewEligibilityNotice
                open={open && requirementsOpen}
                onOpenChange={setRequirementsOpen}
              />
            </>
          )}
          <FieldGroup>
            {/* Logo first, centered, no label — it IS the identity
                anchor of the form. Avatar-style picker matches the
                pattern users have seen on profile setup screens. */}
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={uploadingLogo}
                className={cn(
                  "relative flex size-28 items-center justify-center overflow-hidden rounded-full border border-dashed border-border bg-muted/30 transition-colors hover:border-primary/50",
                  uploadingLogo && "cursor-wait opacity-60"
                )}
                aria-label={t("createLogoLabel")}
              >
                {logoPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={
                      logoPath.startsWith("http") ? logoPath : `${env.BANNER_BASE_URL}/${logoPath}`
                    }
                    alt=""
                    className="size-full object-cover"
                  />
                ) : uploadingLogo ? (
                  <IconLoader2 className="size-7 animate-spin text-muted-foreground" />
                ) : (
                  <IconPhoto className="size-7 text-muted-foreground" />
                )}
              </button>
              <p className="max-w-xs text-center text-[11px] text-muted-foreground">
                {t("createLogoHelp")}
              </p>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleLogoFile(file);
                }}
              />
            </div>

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
            disabled={!name.trim() || !description.trim() || !logoPath || uploadingLogo || creating}
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
