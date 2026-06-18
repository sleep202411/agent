"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { IconLoader2, IconPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import { createProject, ensurePersonalWorkspace } from "@/lib/collab/projects-api";
import { QuickStart } from "./quick-start";
import { HeroVideo } from "./hero-video";

/**
 * Home hero — a full-bleed UI-showcase video background with the headline,
 * "Create new project" CTA and quick-start tools laid over it. The CTA is real
 * (creates + opens a project); the video is decorative (muted, opt-in sound).
 */
export function HomeHero() {
  const t = useTranslations("home");
  const router = useRouter();
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false);

  const onCreate = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const workspace = await ensurePersonalWorkspace();
      const project = await createProject(workspace.id, {
        name: t("untitledProject"),
      });
      router.push(`/project/${project.id}`);
    } catch {
      creatingRef.current = false;
      toast.error(t("createProjectError"));
      setCreating(false);
    }
  }, [router, t]);

  return (
    <section className="relative isolate overflow-hidden rounded-3xl">
      <HeroVideo />

      <div className="relative z-10 flex min-h-[440px] max-w-xl flex-col items-start justify-center p-8 sm:p-12">
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {t("hero.headline")}
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-white/75 sm:text-base">
          {t("hero.subhead")}
        </p>
        <button
          type="button"
          onClick={onCreate}
          disabled={creating}
          aria-busy={creating}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {creating ? (
            <IconLoader2 className="size-4 animate-spin" stroke={2.4} />
          ) : (
            <IconPlus className="size-4" stroke={2.4} />
          )}
          {creating ? t("createProjectLoading") : t("createNewProject")}
        </button>

        <QuickStart className="mt-8" />
      </div>
    </section>
  );
}
