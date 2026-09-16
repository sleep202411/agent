"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCurrentUser } from "@/src/hooks/use-user";
import { crewApi } from "../_hooks/api";

/** Mounted only after workspace access and its initial data have loaded. */
export function CrewVisitReadMarker({ crewId }: { crewId: string }) {
  const { user } = useCurrentUser();
  const accountUserId = user?.id;
  const client = useQueryClient();
  useEffect(() => {
    if (!accountUserId) return;
    const controller = new AbortController();
    let pending = false;
    const markVisibleVisit = async () => {
      if (controller.signal.aborted || document.visibilityState !== "visible" || pending) return;
      pending = true;
      try {
        await crewApi.post(`/notifications/crews/${encodeURIComponent(crewId)}/read`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted)
          await client.invalidateQueries({
            queryKey: ["notifications"],
            predicate: (query) => query.queryKey[2] === accountUserId,
          });
      } catch (error) {
        if (!controller.signal.aborted)
          toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        pending = false;
      }
    };
    queueMicrotask(() => void markVisibleVisit());
    const onVisibility = () => void markVisibleVisit();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [accountUserId, crewId, client]);
  return null;
}
