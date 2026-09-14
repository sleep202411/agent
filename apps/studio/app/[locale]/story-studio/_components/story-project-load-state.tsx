"use client";

import {
  IconAlertTriangle,
  IconArrowLeft,
  IconLock,
  IconLogin2,
  IconRefresh,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { StoryProjectAccessFailure } from "./story-project-access-error";

type StoryProjectLoadStateKind = StoryProjectAccessFailure | "unexpected";

export function StoryProjectLoadState({
  kind,
  onRetry,
  onSignIn,
}: {
  kind: StoryProjectLoadStateKind;
  onRetry: () => void;
  onSignIn?: () => void;
}) {
  const t = useTranslations("storyStudio.projectAccess");
  const accessFailure = kind !== "unexpected";
  const authentication = kind === "authentication";
  const Icon = accessFailure ? IconLock : IconAlertTriangle;
  const title = t(`${kind}.title`);
  const description = t(`${kind}.description`);

  return (
    <main
      data-slot="story-project-load-state"
      className="grid h-dvh w-full place-items-center bg-[var(--canvas-background)] px-6 py-12 text-white"
    >
      <section className="flex w-full max-w-md flex-col items-center text-center">
        <Icon
          className={accessFailure ? "size-8 text-white/42" : "size-8 text-destructive"}
          stroke={1.5}
          aria-hidden="true"
        />
        <h1 className="mt-5 text-lg font-semibold tracking-[-0.015em]">{title}</h1>
        <p className="mt-2 max-w-sm text-sm leading-6 text-white/54">{description}</p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          {authentication ? (
            <Button onClick={onSignIn}>
              <IconLogin2 className="size-4" />
              {t("signIn")}
            </Button>
          ) : kind === "unexpected" ? (
            <Button onClick={onRetry}>
              <IconRefresh className="size-4" />
              {t("retry")}
            </Button>
          ) : (
            <Button asChild>
              <Link href="/story-studio">
                <IconArrowLeft className="size-4" />
                {t("back")}
              </Link>
            </Button>
          )}

          {authentication ? (
            <Button variant="ghost" asChild>
              <Link href="/story-studio">
                <IconArrowLeft className="size-4" />
                {t("back")}
              </Link>
            </Button>
          ) : kind === "unexpected" ? (
            <Button variant="ghost" asChild>
              <Link href="/story-studio">
                <IconArrowLeft className="size-4" />
                {t("back")}
              </Link>
            </Button>
          ) : (
            <Button variant="ghost" onClick={onRetry}>
              <IconRefresh className="size-4" />
              {t("retry")}
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}
