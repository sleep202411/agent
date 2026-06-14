"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import { createProject, ensurePersonalWorkspace } from "@/lib/collab/projects-api";
import { QuickStart } from "./quick-start";
import { HeroCarousel } from "./hero-carousel";

/**
 * Home hero — headline + "Create new project" CTA, with a Cover Flow carousel
 * of sample creations on the right (decorative placeholder thumbnails; the CTA
 * is real — it creates + opens a project).
 */

export function HomeHero() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const onCreate = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const workspace = await ensurePersonalWorkspace();
      const project = await createProject(workspace.id, {
        name: "Untitled project",
      });
      router.push(`/project/${project.id}`);
    } catch {
      toast.error("Couldn't create the project");
      setCreating(false);
    }
  }, [router, creating]);

  return (
    <section className="relative flex gap-8 sm:py-16">
      <div className="relative z-10 flex max-w-xl shrink-0 flex-col items-start justify-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          What are we creating today?
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
          Pick a project type to get started instantly, or simply describe your requirements in your
          own words.
        </p>
        <button
          type="button"
          onClick={onCreate}
          disabled={creating}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <IconPlus className="size-4" stroke={2.4} />
          Create new project
        </button>

        <QuickStart className="mt-8" />
      </div>

      {/* Decorative Cover Flow carousel — fills the space right of the text and
          centres its content there (xl+ only). */}
      <div className="relative hidden flex-1 xl:block">
        <HeroCarousel />
      </div>
    </section>
  );
}
