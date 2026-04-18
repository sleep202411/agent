"use client";

import { useEffect, useRef } from "react";
import { useAppDispatch } from "@/src/store";
import {
  pushAttachment,
  sendUserMessage,
  setAgentType,
  setDraft,
} from "@/src/store/slices/assistantSlice";
import { setActivePanel } from "@/src/store/slices/projectSlice";
import type { AssistantAgentType } from "@/src/types/assistant-contracts";
import type { StudioAgent, StudioSeed } from "@/src/types/studio-seed";
import { useStudioSeed } from "./use-studio-seed";

/**
 * Maps the studio composer's chip selection to the legacy assistantSlice
 * agent type. "episode" and "prop" have no dedicated agent — we fall back
 * to "general" which is the catch-all persona that can still reason about
 * those domains. Post-v3-merge this mapping can route to dedicated
 * ask_episode_planner / future prop designer instead.
 */
function mapSeedAgent(agent: StudioAgent): AssistantAgentType {
  switch (agent) {
    case "character":
      return "character";
    case "scene":
      return "scene";
    case "episode":
    case "prop":
    default:
      return "general";
  }
}

/**
 * One-shot bootstrap for projects opened via the studio composer.
 *
 * Listens for a seed from the parent iframe (studio home → creatorCenter
 * → workspace → this hook). When seed + projectId are both ready, it:
 *
 *   1. Opens the AI assistant panel (so the user sees the chat).
 *   2. Pushes the uploaded script (if any) into the conversation's
 *      attachments with status=uploaded (path/url already live on OSS).
 *   3. Sets the chip-selected agent type.
 *   4. Primes the draft input with the user's prompt.
 *   5. Fires sendUserMessage(projectId) to kick the assistant off.
 *
 * Guarded by a ref so it only runs once per page load. If the user
 * refreshes, the parent's sessionStorage has been cleared (see
 * use-studio-seed.ts), so no duplicate send.
 */
export function useStudioSeedConsumer(projectId: string | null | undefined): {
  seed: StudioSeed | null;
  consumed: boolean;
} {
  const { seed } = useStudioSeed();
  const dispatch = useAppDispatch();
  const consumedRef = useRef(false);

  useEffect(() => {
    if (!seed || !projectId || consumedRef.current) return;
    consumedRef.current = true;

    console.info("[studio-seed-consumer] bootstrapping", {
      projectId,
      agent: seed.agent,
      hasAttachment: !!seed.attachment,
    });

    dispatch(setActivePanel("aiAssistant"));

    if (seed.attachment) {
      dispatch(
        pushAttachment({
          projectId,
          attachment: {
            id:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `att_${Date.now()}`,
            name: seed.attachment.name,
            mimeType: seed.attachment.mimeType,
            size: seed.attachment.size,
            path: seed.attachment.path,
            url: seed.attachment.url,
            status: "uploaded",
          },
        })
      );
    }

    dispatch(setAgentType({ projectId, agentType: mapSeedAgent(seed.agent) }));
    dispatch(setDraft({ projectId, draft: seed.prompt }));

    // Defer one tick so the slice updates land before the thunk reads state.
    void Promise.resolve().then(() => {
      void dispatch(sendUserMessage(projectId));
    });
  }, [seed, projectId, dispatch]);

  return { seed, consumed: consumedRef.current };
}
