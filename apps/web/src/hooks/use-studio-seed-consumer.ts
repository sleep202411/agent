"use client";

import { useEffect, useRef } from "react";
import { useAppDispatch } from "@/src/store";
import {
  pushAttachment,
  sendUserMessage,
  setAgentType,
  setDraft,
  setForcedPersona,
} from "@/src/store/slices/assistantSlice";
import { setActivePanel } from "@/src/store/slices/projectSlice";
import type { AssistantAgentType } from "@/src/types/assistant-contracts";
import type { StudioAgent, StudioSeed } from "@/src/types/studio-seed";
import type { ForcedPersonaKey } from "@repo/shared";
import { useStudioSeed } from "./use-studio-seed";

/**
 * Maps the studio composer's chip selection to the legacy assistantSlice
 * agent type. "episode" and "prop" have no dedicated agent — we fall back
 * to "general" which is the catch-all persona that can still reason about
 * those domains. Null (no chip selected) also returns "general" so the
 * supervisor routes freely without a pinned persona.
 */
function mapSeedAgent(agent: StudioAgent | null): AssistantAgentType {
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
 * Maps the studio composer's chip selection to the forced-persona wire
 * key consumed by the supervisor. Returns null when no chip is selected
 * so the workspace skips the forced-persona dispatch entirely — that's
 * the path that lets a casual "你好" reach the supervisor unprefixed,
 * avoiding the "角色设计师 / 你好" hard-route into character_designer.
 */
function mapSeedAgentToForcedPersona(agent: StudioAgent | null): ForcedPersonaKey | null {
  switch (agent) {
    case "character":
      return "character_designer";
    case "scene":
      return "scene_designer";
    case "prop":
      return "prop_designer";
    case "episode":
      return "episode_planner";
    default:
      return null;
  }
}

/**
 * One-shot bootstrap for projects opened via the studio composer.
 *
 * Reads a seed left in sessionStorage by the studio home composer.
 * When seed + projectId are both ready, it:
 *
 *   1. Opens the AI assistant panel (so the user sees the chat).
 *   2. Pushes the uploaded script (if any) into the conversation's
 *      attachments with status=uploaded (path/url already live on OSS).
 *   3. Sets the chip-selected agent type.
 *   4. Primes the draft input with the user's prompt.
 *   5. Fires sendUserMessage(projectId) to kick the assistant off.
 *
 * Guarded by a ref so it only runs once per page load. The seed is
 * removed from sessionStorage on first read in `useStudioSeed`, so a
 * page refresh starts clean.
 */
export function useStudioSeedConsumer(projectId: string | null | undefined): {
  seed: StudioSeed | null;
  consumed: boolean;
} {
  const { seed } = useStudioSeed(projectId);
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
    // Only pin a forced persona when the user explicitly picked a chip.
    // Null = freeform prompt → leave forcedPersona alone so the
    // supervisor routes by content, not by a default fallback.
    const forced = mapSeedAgentToForcedPersona(seed.agent);
    if (forced) {
      dispatch(setForcedPersona({ projectId, forcedPersona: forced }));
    }
    dispatch(setDraft({ projectId, draft: seed.prompt }));

    // Defer one tick so the slice updates land before the thunk reads state.
    void Promise.resolve().then(() => {
      void dispatch(sendUserMessage(projectId));
    });
  }, [seed, projectId, dispatch]);

  return { seed, consumed: consumedRef.current };
}
