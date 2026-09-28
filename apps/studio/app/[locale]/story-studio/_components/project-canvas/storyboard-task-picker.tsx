"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  linkStoryboardChild,
  listStoryboardTaskCandidates,
} from "@/lib/collab/storyboard-children-api";
import { storyApiErrorMessage } from "@/lib/story-projects-api";

export function StoryboardTaskPicker({
  projectId,
  nodeId,
  onClose,
}: {
  projectId: string;
  nodeId: string;
  onClose: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.inspector.storyboard");
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string>();
  const query = useQuery({
    queryKey: ["storyboard-task-candidates", projectId, search, cursor],
    queryFn: ({ signal }) => listStoryboardTaskCandidates(projectId, search, cursor, signal),
    retry: false,
  });
  const link = useMutation({
    mutationFn: (taskId: string) => linkStoryboardChild(projectId, nodeId, taskId),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["storyboard-children", projectId] });
      await client.invalidateQueries({ queryKey: ["storyboard-task-candidates", projectId] });
    },
  });
  return (
    <div className="mt-3 space-y-2 rounded-xl bg-white/[0.04] p-3" aria-label={t("linkTask")}>
      <p className="text-[11px] text-white/50">{t("linkTaskDescription")}</p>
      <input
        aria-label={t("searchTasks")}
        placeholder={t("searchTasks")}
        className="w-full rounded-lg bg-white/[0.06] px-3 py-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        value={search}
        maxLength={180}
        disabled={link.isPending}
        onChange={(event) => {
          setSearch(event.target.value);
          setCursor(undefined);
        }}
      />
      {query.isPending ? (
        <p role="status" className="text-xs text-white/50">
          {t("loading")}
        </p>
      ) : query.isError ? (
        <div role="alert" className="text-xs text-white/70">
          {storyApiErrorMessage(query.error, t("taskListError"))}
          <button type="button" className="ml-2 underline" onClick={() => void query.refetch()}>
            {t("retryTasks")}
          </button>
        </div>
      ) : (
        <>
          {!query.data.items.length && (
            <p className="text-xs text-white/50">{t("noEligibleTasks")}</p>
          )}
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {query.data.items.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  disabled={link.isPending}
                  className="w-full rounded-lg px-2 py-2 text-left text-xs text-white/80 hover:bg-white/[0.08] disabled:opacity-50"
                  onClick={() =>
                    link.mutate(task.id, {
                      onSuccess: (result) => {
                        if (result.taskId !== task.id) {
                          toast.error(t("taskAlreadyLinked"));
                        } else {
                          toast.success(t("taskLinked"));
                        }
                        onClose();
                      },
                      onError: (error) =>
                        toast.error(storyApiErrorMessage(error, t("linkTaskError"))),
                    })
                  }
                >
                  TASK-{task.number} · {task.title}
                </button>
              </li>
            ))}
          </ul>
          {query.data.nextCursor && (
            <button
              type="button"
              disabled={link.isPending}
              className="text-xs text-white/70 underline"
              onClick={() => setCursor(query.data.nextCursor!)}
            >
              {t("moreTasks")}
            </button>
          )}
        </>
      )}
      <button
        type="button"
        disabled={link.isPending}
        className="rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs text-white/70 disabled:opacity-50"
        onClick={onClose}
      >
        {t("cancelLink")}
      </button>
    </div>
  );
}
