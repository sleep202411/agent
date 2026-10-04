"use client";
import { IconHeart, IconHeartFilled } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { crewApi } from "../_hooks/api";
export function SaveOpening({ positionId }: { positionId: string }) {
  const { user } = useCurrentUser();
  return (
    <SaveSession key={`${user?.id}:${positionId}`} positionId={positionId} userId={user?.id} />
  );
}
function SaveSession({ positionId, userId }: { positionId: string; userId?: string }) {
  const t = useTranslations("crewOpening");
  const auth = useAuthDialog();
  const client = useQueryClient();
  const queryKey = ["saved-opening", positionId, userId];
  const path = `/positions/${encodeURIComponent(positionId)}/saved`;
  const state = useQuery({
    queryKey,
    enabled: Boolean(userId),
    retry: false,
    queryFn: ({ signal }) => crewApi.get<{ saved: boolean }>(path, { signal, cache: "no-store" }),
  });
  const save = useMutation({
    mutationFn: (saved: boolean) =>
      saved ? crewApi.put<{ saved: boolean }>(path) : crewApi.delete<{ saved: boolean }>(path),
    onSuccess: (data) => {
      client.setQueryData(queryKey, data);
      void client.invalidateQueries({ queryKey: ["crew", "positions", "public"] });
    },
  });
  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        color="muted"
        aria-label={state.isError ? t("retry") : state.data?.saved ? t("saved") : t("save")}
        title={state.isError ? t("retry") : state.data?.saved ? t("saved") : t("save")}
        icon={state.data?.saved ? <IconHeartFilled className="text-primary" /> : <IconHeart />}
        disabled={save.isPending || Boolean(userId && state.isPending)}
        aria-pressed={state.data?.saved ?? false}
        onClick={() => {
          if (!userId) auth.open();
          else if (state.isError) void state.refetch();
          else save.mutate(!state.data?.saved);
        }}
      >
        {state.isError ? t("retry") : state.data?.saved ? t("saved") : t("save")}
      </Button>
      {(state.error || save.error) && (
        <p role="alert" className="text-sm text-destructive">
          {(state.error || save.error)?.message}
        </p>
      )}
    </div>
  );
}
