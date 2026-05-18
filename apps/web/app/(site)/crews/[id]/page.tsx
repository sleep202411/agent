"use client";

/**
 * Crew detail — single canonical layout backed by `/aurora/crews/:id`.
 *
 * The legacy fizzdragon-web `projectDetail`-backed fallback was deleted
 * once the Nest crew module shipped; everything now resolves through
 * the new endpoint or 404s cleanly.
 */

import { useParams } from "next/navigation";
import { IconLoader2 } from "@tabler/icons-react";
import { useCrewDetail } from "@/app/(site)/crews/_hooks/use-crew";
import { CrewDetail } from "./_components/crew-detail-new";

export default function CrewDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: crew, isLoading } = useCrewDetail(id);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!crew) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Not found
      </div>
    );
  }

  return <CrewDetail crew={crew} />;
}
