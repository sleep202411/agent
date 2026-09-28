"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconLockOpen, IconMasksTheater, IconPlus } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/_components/auth-provider";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";
import { useCharacterOperation } from "@/app/[locale]/(studio)/characters/_lib/use-character-operation";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import { useProjectUIStore } from "@/app/[locale]/project/_stores/project-ui-store";
import { api, ApiRequestError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DrawerPanel } from "@/components/ui/drawer-panel";

type Actor = { id: string; name: string; photoUrl: string; unlocked: boolean };
type ActorUse = {
  nodeId: string;
  actorId: string;
  name: string;
  mediaAssetId: string;
  url: string;
};
export function AiActorsPanel({
  onClose,
  documentId,
}: {
  onClose: () => void;
  documentId: string;
}) {
  const { user } = useAuth();
  const { workspaceId, projectId, canEdit } = useProjectContext();
  return (
    <ActorLibrary
      key={`${user?.id}:${workspaceId}:${projectId}:${canEdit}`}
      onClose={onClose}
      documentId={documentId}
    />
  );
}
function ActorLibrary({ onClose, documentId }: { onClose: () => void; documentId: string }) {
  const t = useTranslations("aiActors");
  const { user } = useAuth();
  const { workspaceId, projectId, canEdit } = useProjectContext();
  const graph = useCanvasGraphContext();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const retryIds = useRef(new Map<string, string>());
  const operation = useCharacterOperation(`${workspaceId}:${projectId}:${canEdit}`, () =>
    setBusy(null)
  );
  const key = ["ai-actors", user?.id, workspaceId, page];
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(user?.id && workspaceId),
    retry: false,
    queryFn: ({ signal }) =>
      api.get<{ items: Actor[]; hasMore: boolean }>("/aurora/ai-actors", {
        params: { workspaceId: workspaceId!, page },
        signal,
        requestScope: "user",
        cache: "no-store",
      }),
  });
  async function act(actor: Actor) {
    if (!canEdit || !graph.canEdit || !workspaceId) return;
    const run = operation.start();
    if (!run) return;
    setBusy(actor.id);
    setError(null);
    setNotice(null);
    try {
      if (!actor.unlocked) {
        await api.post(`/aurora/ai-actors/${actor.id}/unlock`, {
          data: { workspaceId },
          signal: run.signal,
          requestScope: "user",
        });
        if (!operation.isCurrent(run)) return;
        await client.invalidateQueries({ queryKey: ["ai-actors", user?.id, workspaceId] });
      } else {
        const requestId = retryIds.current.get(actor.id) ?? crypto.randomUUID();
        retryIds.current.set(actor.id, requestId);
        const result = await api.post<ActorUse>(`/aurora/ai-actors/${actor.id}/use`, {
          data: { projectId, requestId },
          signal: run.signal,
          requestScope: "project",
        });
        if (!operation.isCurrent(run)) return;
        if (result.nodeId !== requestId || result.actorId !== actor.id)
          throw new Error(t("invalidResponse"));
        if (!graph.getNode(result.nodeId)) {
          graph.addNode({
            id: result.nodeId,
            type: "image",
            position: { x: 80 + graph.getNodes().length * 24, y: 80 },
            data: {
              src: result.url,
              mediaAssetId: result.mediaAssetId,
              label: result.name,
              aiActorId: result.actorId,
            },
          });
          graph.selectNodes([result.nodeId]);
        }
        useProjectUIStore.getState().focusActor(result.nodeId, documentId);
        retryIds.current.delete(actor.id);
        setNotice(t("added", { name: result.name }));
      }
    } catch (err) {
      if (operation.isCurrent(run)) {
        if (err instanceof ApiRequestError && err.code === "AI_ACTOR_PHOTO_CHANGED") {
          // This identity can never succeed again; ordinary network retries must keep theirs.
          retryIds.current.delete(actor.id);
          void client.invalidateQueries({ queryKey: ["ai-actors", user?.id, workspaceId] });
        }
        setError(err instanceof Error ? err.message : t("failed"));
      }
    } finally {
      if (operation.finish(run)) setBusy(null);
    }
  }
  return (
    <>
      <DrawerPanel.Header
        title={t("title")}
        icon={<IconMasksTheater className="size-4" />}
        closeLabel={t("close")}
        onClose={onClose}
      />
      <DrawerPanel.Body className="px-4 pb-4">
        <p className="mb-4 text-xs text-muted-foreground">{t("intro")}</p>
        {query.isPending && <p role="status">{t("loading")}</p>}
        {query.isError && (
          <div role="alert" className="space-y-2 text-sm">
            <p>{query.error.message}</p>
            <Button variant="secondary" onClick={() => void query.refetch()}>
              {t("retry")}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mb-3 text-sm">
            {notice}
          </p>
        )}
        {!query.isError && (
          <div className="grid grid-cols-2 gap-3">
            {query.data?.items.map((actor) => (
              <article key={actor.id} className="overflow-hidden rounded-2xl bg-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={actor.photoUrl}
                  alt={actor.name}
                  className="aspect-[3/4] w-full object-cover"
                />
                <div className="space-y-2 p-2.5">
                  <h3 className="truncate text-sm font-medium" title={actor.name}>
                    {actor.name}
                  </h3>
                  <Button
                    className="w-full"
                    size="sm"
                    variant={actor.unlocked ? "default" : "secondary"}
                    disabled={!canEdit || !graph.canEdit || busy !== null}
                    onClick={() => void act(actor)}
                  >
                    {actor.unlocked ? (
                      <IconPlus className="size-3.5" />
                    ) : (
                      <IconLockOpen className="size-3.5" />
                    )}
                    {busy === actor.id ? t("working") : actor.unlocked ? t("use") : t("unlock")}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
        {query.data?.items.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        )}
        {!canEdit && <p className="mt-4 text-xs text-muted-foreground">{t("readOnly")}</p>}
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={page === 1 || busy !== null}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("previous")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("page", { page })}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={!query.data?.hasMore || busy !== null}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("next")}
          </Button>
        </div>
      </DrawerPanel.Body>
    </>
  );
}
