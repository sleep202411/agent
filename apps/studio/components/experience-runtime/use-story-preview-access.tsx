"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { IconLock } from "@tabler/icons-react";
import type { ExperienceAccessRequirement } from "@repo/shared/experience-runtime";
import type { ExperiencePlayerProps } from "@repo/experience-player-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useVideoPoster } from "@/components/media/use-video-poster";

type AccessRequest = {
  requirement: ExperienceAccessRequirement;
  resolve: (allowed: boolean) => void;
};

/** Local playtest permissions only; never calls the wallet or purchase API. */
export function useStoryPreviewAccess(locale: string) {
  const t = useTranslations("experiencePlayer.communityAccess");
  const unlocked = useRef(new Set<string>());
  const pending = useRef<AccessRequest | null>(null);
  const [request, setRequest] = useState<AccessRequest | null>(null);
  const finish = useCallback((allowed: boolean) => {
    const current = pending.current;
    pending.current = null;
    if (allowed && current) unlocked.current.add(current.requirement.key);
    setRequest(null);
    current?.resolve(allowed);
  }, []);

  useEffect(
    () => () => {
      pending.current?.resolve(false);
      pending.current = null;
    },
    []
  );

  const access = useMemo<NonNullable<ExperiencePlayerProps["access"]>>(
    () => ({
      canAccess: (requirement) => unlocked.current.has(requirement.key),
      requestAccess: (requirement) =>
        new Promise<boolean>((resolve) => {
          pending.current?.resolve(false);
          const next = { requirement, resolve };
          pending.current = next;
          setRequest(next);
        }),
      formatPrice: (amount) => t("price", { amount }),
      renderPreview: (media) => <PlaytestFirstFrame {...media} />,
    }),
    [t]
  );

  const title = request?.requirement.title;
  const dialog = (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open) finish(false);
      }}
    >
      <DialogContent className="gap-0 p-6 sm:max-w-sm" overlayClassName="bg-black/20">
        <div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-white/[0.06] text-brand-yellow">
          <IconLock className="size-5" aria-hidden />
        </div>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription className="mt-2">
          {title?.[locale] ?? (title ? Object.values(title)[0] : "")}
        </DialogDescription>
        {request ? (
          <p className="mt-5 text-2xl font-semibold text-brand-yellow tabular-nums">
            {t("price", { amount: request.requirement.communityPointPrice })}
          </p>
        ) : null}
        <p className="mt-2 text-sm text-muted-foreground">{t("chargeHint")}</p>
        <p className="mt-3 text-sm text-white/80">{t("previewHint")}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => finish(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={() => finish(true)}>{t("unlock")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
  return { access, dialog };
}

function PlaytestFirstFrame({ videoUri, posterUri }: { videoUri?: string; posterUri?: string }) {
  const poster = useVideoPoster(
    videoUri ?? "",
    undefined,
    undefined,
    Boolean(videoUri && !posterUri)
  );
  const src = posterUri ?? (poster.data?.status === "ready" ? poster.data.url : undefined);
  return src ? (
    <Image src={src} alt="" fill unoptimized sizes="100vw" className="object-cover" />
  ) : null;
}
