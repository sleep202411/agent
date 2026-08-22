"use client";

import { useTranslations } from "next-intl";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { type StoryAssetSpec } from "@/lib/story-production-api";
import { StoryProductionConflictPanel } from "./story-production-conflict-panel";
import { StoryProductionGenerationControl } from "./story-production-generation-control";

/**
 * Display-and-generate card: basic identity plus the saved prompt on the
 * left, one square media slot with a single generate action on the right.
 * Editing is deliberately absent for now; the prompt textarea is read-only
 * so the input-box presentation never pretends to save anything.
 */
export function StoryAssetSpecCard({
  asset,
  workspaceId,
  projectId,
  chapterId,
}: {
  asset: StoryAssetSpec;
  workspaceId: string;
  projectId: string;
  chapterId: string;
}) {
  const t = useTranslations("storyStudio.assetsPage");
  const reference = asset.stableKey.startsWith("@") ? asset.stableKey : `@${asset.stableKey}`;

  return (
    <article className="rounded-2xl bg-white/[0.045] p-4 text-white shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-white/[0.09] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/72">
              {t(`kinds.${asset.kind}`)}
            </span>
            {asset.status !== "current" ? (
              <span className="rounded-md bg-amber-300/12 px-2 py-1 text-[10px] font-semibold text-amber-100/85">
                {t(`status.${asset.status}`)}
              </span>
            ) : null}
          </div>
          <h2 className="mt-3 truncate text-base font-semibold text-white/94">{asset.name}</h2>
          <code className="mt-1 block truncate text-xs text-white/62">{reference}</code>

          {asset.description ? (
            <p className="mt-3 line-clamp-3 text-sm leading-6 text-white/70">{asset.description}</p>
          ) : null}

          <Field
            dense
            className="mt-4"
            label={t("imagePrompt")}
            htmlFor={`asset-prompt-${asset.id}`}
          >
            <Textarea
              id={`asset-prompt-${asset.id}`}
              value={asset.imagePrompt}
              readOnly
              className="min-h-24 bg-white/[0.07] text-xs leading-5 text-white/85"
            />
          </Field>
        </div>

        <div className="shrink-0 md:w-[240px]">
          <StoryProductionGenerationControl
            scope={{ workspaceId, projectId, chapterId }}
            target={{
              kind: "asset_spec",
              id: asset.id,
              sequenceId: null,
              version: asset.version,
              status: asset.status,
              latestGeneration: asset.latestGeneration,
            }}
            label={asset.name}
            selectedMedia={asset.selectedMediaVersion}
          />
        </div>
      </div>

      <StoryProductionConflictPanel
        scope={{ workspaceId, projectId, chapterId }}
        target={{ kind: "asset_spec", item: asset }}
      />
    </article>
  );
}
