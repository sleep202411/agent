"use client";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { crewApi } from "../_hooks/api";

const requestsSchema = z.array(
  z.object({
    id: z.string(),
    status: z.enum(["pending", "approved", "rejected"]),
    kind: z.string(),
    input: z.object({ title: z.string().optional() }),
    decisionNote: z.string().nullable().optional(),
  })
);
export function TaskRequestHistory({ crewId }: { crewId: string }) {
  const { user } = useCurrentUser();
  const t = useTranslations("crewTasks.approval");
  const query = useQuery({
    queryKey: ["crew-task-requests", crewId, user?.id],
    enabled: !!user,
    queryFn: async ({ signal }) =>
      requestsSchema.parse(
        await crewApi.get<unknown>(`/crews/${encodeURIComponent(crewId)}/task-requests`, { signal })
      ),
    refetchInterval: 10_000,
  });
  return (
    <details className="px-4 py-2 text-sm">
      <summary className="cursor-pointer">
        {t("title")}{" "}
        {query.data ? `(${query.data.filter((r) => r.status === "pending").length})` : ""}
      </summary>
      {query.isError ? (
        <div role="alert">
          {t("loadFailed")} <Button onClick={() => void query.refetch()}>{t("retry")}</Button>
        </div>
      ) : null}
      {query.data?.length === 0 ? <p>{t("empty")}</p> : null}
      <ul className="space-y-2 py-2">
        {query.data?.map((row) => (
          <li key={row.id}>
            <span>{row.input.title ?? row.id}</span> · <span role="status">{t(row.status)}</span>
            {row.decisionNote ? <p className="text-muted-foreground">{row.decisionNote}</p> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
