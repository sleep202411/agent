"use client";

/**
 * Crew detail — orchestrator.
 *
 * Two layouts coexist while the backend migration from
 * `/project/query` (legacy project rows) to `/project/crew/detail/:id`
 * (new crew schema) is in flight:
 *
 *   1. Try the new endpoint via `useCrewDetail`.
 *   2. If it returns `null` (or fails), fall back to the legacy
 *      `useProjectDetail` chain.
 *   3. Render the layout matching whichever endpoint produced data:
 *      - new → `CrewDetailNew` (the canonical PRD layout)
 *      - legacy → `CrewDetailLegacy` (the older PC layout, ported from
 *                 fizzdragon-web's projectDetail.vue)
 *
 * Each sub-layout owns its own related-data hooks (jobs / members /
 * video link / owner), so the orchestrator stays narrow — it only
 * picks which layout to mount.
 */

import { useParams } from "next/navigation";
import { IconLoader2 } from "@tabler/icons-react";

import { useCrewDetail } from "@/app/(site)/crews/_hooks/use-crew";
import { useProjectDetail } from "@/app/(site)/crews/_hooks/use-projects";
import { CrewDetailLegacy } from "./_components/crew-detail-legacy";
import { CrewDetailNew } from "./_components/crew-detail-new";

export default function CrewDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  // First-choice: new crew endpoint. `useCrewDetail` resolves to `null`
  // when the backend reports no row for this id (HTTP 404 OR envelope
  // `code !== 200`), and throws on real network / 5xx errors.
  const { data: crew, isLoading: crewLoading, isError: crewError } = useCrewDetail(id);

  // Fallback gate. Only fire the legacy fetch once we *know* the new
  // endpoint missed — i.e. the crew query has resolved AND it produced
  // no data (null) or surfaced an error. While the new query is still
  // in flight we keep the legacy one parked so we don't double-hit
  // every page load.
  const shouldFallback = !crewLoading && (crew === null || crewError);
  const { data: project, isLoading: projectLoading } = useProjectDetail(
    shouldFallback ? id : undefined
  );

  if (crewLoading || (shouldFallback && projectLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (crew) {
    return <CrewDetailNew />;
  }

  if (project) {
    return <CrewDetailLegacy />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      Not found
    </div>
  );
}
