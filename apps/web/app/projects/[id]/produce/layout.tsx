"use client";

/**
 * Produce wizard chrome — header (project title left, stepper center,
 * account right) → content canvas → footer (status text + next CTA).
 *
 * Built on the app's shadcn design tokens (`bg-background`,
 * `text-foreground`, `bg-muted`, `bg-primary`, etc.) so colors and
 * radii match the rest of the app rather than inventing a parallel
 * palette. Layout structure is borrowed from Jianying / 小云雀
 * (verified via Chrome DevTools 2026-05-05).
 */

import { useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCircleCheckFilled,
  IconLayoutDashboard,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ProduceStepper } from "./_components/produce-stepper";
import { PRODUCE_STEPS } from "./_data/steps";
import { useProduceCommittedResult, useProduceSeed } from "./_hooks/use-produce-seed";
import { useStepAdvanceHandler } from "./_hooks/use-step-advance";

export default function ProduceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const projectId = String(params.id ?? "");
  const seed = useProduceSeed(projectId);
  const committed = useProduceCommittedResult(projectId, !seed);
  const projectTitle = seed?.worldName || committed?.title || "Production Pipeline";
  const advanceHandler = useStepAdvanceHandler();
  const [advancing, setAdvancing] = useState(false);

  const currentIndex = Math.max(
    0,
    PRODUCE_STEPS.findIndex((step) => pathname.endsWith(`/${step.key}`))
  );
  const prevStep = currentIndex > 0 ? PRODUCE_STEPS[currentIndex - 1] : null;
  const nextStep = currentIndex < PRODUCE_STEPS.length - 1 ? PRODUCE_STEPS[currentIndex + 1] : null;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-[68px] shrink-0 items-center px-6">
        <div className="flex flex-1 items-center gap-3">
          <Button
            variant="ghost"
            color="muted"
            size="icon-sm"
            onClick={() => router.push(`/projects/${projectId}`)}
            aria-label="Back"
          >
            <IconArrowLeft className="size-4" />
          </Button>
          <h1 className="truncate text-base font-medium">{projectTitle}</h1>
        </div>

        <ProduceStepper currentIndex={currentIndex} projectId={projectId} />

        {/* Right gutter — only the project-space jump for now.
            Wrapped in a flex-1 + justify-end so the stepper stays
            centered between this and the matching flex-1 on the
            left. Mirrors the same affordance in the per-episode
            video editor header. */}
        <div className="flex flex-1 justify-end">
          <Button
            variant="outline"
            color="muted"
            size="sm"
            onClick={() => router.push(`/projects/${projectId}`)}
          >
            <IconLayoutDashboard /> 进入项目空间
          </Button>
        </div>
      </header>

      {/* Each step page sets its own max-width inside `children`
          (script narrow for readability, asset / video wide for the
          card grids). Layout only owns the outer scroll container
          and gutter padding. */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-6 py-6">{children}</div>
      </main>

      {/* Footer — status text on the left, prev/next as a single
          right-aligned cluster (matches editor-style wizards where
          the linear back/forth pair lives together). Stepper jumps
          in the header still work; this is the keyboard-friendly
          linear path. */}
      <footer className="flex h-16 shrink-0 items-center gap-4 px-6">
        <span className="flex flex-1 items-center gap-2 text-sm text-muted-foreground">
          <IconCircleCheckFilled className="size-4 opacity-60" />
          {nextStep ? "本步内容整理完毕，可以进行下一步了" : "全部步骤已完成"}
        </span>
        <div className="flex items-center gap-2">
          {prevStep ? (
            <Button asChild variant="outline" color="muted" size="lg">
              <Link href={`/projects/${projectId}/produce/${prevStep.key}`}>
                <IconArrowLeft /> 上一步
              </Link>
            </Button>
          ) : (
            <Button variant="outline" color="muted" size="lg" disabled>
              <IconArrowLeft /> 上一步
            </Button>
          )}
          {nextStep ? (
            // When the current page registers an advance handler (e.g.
            // /produce/asset has step2 drafts pending commit), call
            // that handler — it owns commit + navigation. Otherwise
            // fall through to plain link navigation.
            advanceHandler ? (
              <Button
                variant="solid"
                color="primary"
                size="lg"
                disabled={advancing}
                onClick={async () => {
                  setAdvancing(true);
                  try {
                    await advanceHandler();
                  } catch (err) {
                    console.error("[produce/layout] advance handler failed:", err);
                  } finally {
                    setAdvancing(false);
                  }
                }}
              >
                {advancing ? "正在保存…" : "下一步"}
                <IconArrowRight />
              </Button>
            ) : (
              <Button asChild variant="solid" color="primary" size="lg">
                <Link href={`/projects/${projectId}/produce/${nextStep.key}`}>
                  下一步 <IconArrowRight />
                </Link>
              </Button>
            )
          ) : (
            <Button variant="solid" color="muted" size="lg" disabled>
              完成
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
