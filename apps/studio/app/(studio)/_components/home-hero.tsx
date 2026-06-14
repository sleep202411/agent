"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
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
    <section className="relative isolate overflow-hidden rounded-3xl">
      <HeroVideo />

      <div className="relative z-10 flex min-h-[440px] max-w-xl flex-col items-start justify-center p-8 sm:p-12">
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          What are we creating today?
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-white/75 sm:text-base">
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
    </section>
  );
}
