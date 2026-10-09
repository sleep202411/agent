"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useAuth } from "@/app/_components/auth-provider";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

type PublicationDialogOwner = {
  scopeKey: string;
  running: boolean;
  abandoned: boolean;
  generation: number;
};

/** Save the mounted canvas before opening publication details in place. */
export function useStoryPublicationDialog(projectId: string, beforeOpen?: () => Promise<void>) {
  const t = useTranslations("storyStudio.canvas.publish");
  const { user, isCurrentAccount } = useAuth();
  const userId = user?.id ?? null;
  const scopeKey = JSON.stringify([projectId, userId]);
  const draftBarrier = useStoryProjectUiStore((state) => state.draftBarrier);
  const ownerRef = useRef<PublicationDialogOwner | null>(null);
  const [state, setState] = useState({ scopeKey, open: false, pending: false });
  if (state.scopeKey !== scopeKey) {
    setState({ scopeKey, open: false, pending: false });
  }
  useLayoutEffect(() => {
    const owner = { scopeKey, running: false, abandoned: false, generation: 0 };
    ownerRef.current = owner;
    return () => {
      owner.abandoned = true;
      if (ownerRef.current === owner) ownerRef.current = null;
    };
  }, [scopeKey]);

  const openPublication = useCallback(async () => {
    const owner = ownerRef.current;
    if (
      !owner ||
      owner.scopeKey !== scopeKey ||
      owner.running ||
      owner.abandoned ||
      userId == null ||
      (state.scopeKey === scopeKey && state.open)
    )
      return;
    const generation = ++owner.generation;
    const isCurrent = () =>
      ownerRef.current === owner &&
      !owner.abandoned &&
      owner.generation === generation &&
      isCurrentAccount(userId);
    if (!isCurrent()) return;
    owner.running = true;
    setState({ scopeKey, open: false, pending: true });
    try {
      if (beforeOpen) await beforeOpen();
      if (!isCurrent()) return;
      if (draftBarrier) await draftBarrier(async () => undefined);
      if (isCurrent()) setState({ scopeKey, open: true, pending: false });
    } catch (error) {
      if (isCurrent()) toast.error(storyApiErrorMessage(error, t("errors.saveFailed")));
    } finally {
      if (isCurrent()) {
        owner.running = false;
        setState((current) => ({ ...current, pending: false }));
      }
    }
  }, [beforeOpen, draftBarrier, isCurrentAccount, scopeKey, state.open, state.scopeKey, t, userId]);

  const closePublication = useCallback(() => {
    const owner = ownerRef.current;
    if (owner && owner.scopeKey !== scopeKey) return;
    if (owner) {
      owner.generation += 1;
      owner.running = false;
    }
    setState({ scopeKey, open: false, pending: false });
  }, [scopeKey]);

  const isOwnState = state.scopeKey === scopeKey;
  return {
    open: isOwnState && state.open,
    openPublication,
    closePublication,
    pending: isOwnState && state.pending,
  };
}
