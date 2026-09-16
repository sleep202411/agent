import { useEffect, useState } from "react";

import {
  getActiveStoryAgentRun,
  getStoryAgentRun,
  type StoryAgentRunDto,
} from "../api/story-agent-runs-api";
import { isAgentOsId } from "../lib/ids";
import { useStoryRequestScope } from "./use-story-request-scope";

const POLL_MS = 1_500;

/**
 * Polls the chapter's Story authoring-run head while Agent OS is in flight or
 * the run is still `authoring` / `applying` — same cadence as PC Story Studio.
 */
export function useStoryAuthoringRun(
  projectId: string,
  chapterId: string,
  agentBusy: boolean
): StoryAgentRunDto | null {
  const [run, setRun] = useState<StoryAgentRunDto | null>(null);
  const projectOk = isAgentOsId(projectId);
  const chapterOk = isAgentOsId(chapterId);
  const identity = useStoryRequestScope(`${projectId}:${chapterId}`);
  const [previousIdentity, setPreviousIdentity] = useState(identity);
  if (previousIdentity !== identity) {
    setPreviousIdentity(identity);
    setRun(null);
  }

  useEffect(() => {
    if (!identity.enabled || !projectOk || !chapterOk) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const next = await getActiveStoryAgentRun(projectId, chapterId, controller.signal);
        if (cancelled) return;
        setRun(next);
        const keepGoing = agentBusy || next?.status === "authoring" || next?.status === "applying";
        if (keepGoing) timer = setTimeout(() => void tick(), POLL_MS);
      } catch {
        if (!cancelled && agentBusy) timer = setTimeout(() => void tick(), POLL_MS);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [agentBusy, chapterId, chapterOk, projectId, projectOk, identity]);

  return run;
}

/** Immutable Story run named by an Agent approval (may differ from the chapter head). */
export function useStoryAgentRunById(
  projectId: string,
  runId: string | null
): StoryAgentRunDto | null {
  const [run, setRun] = useState<StoryAgentRunDto | null>(null);
  const projectOk = isAgentOsId(projectId);
  const runOk = isAgentOsId(runId);
  const identity = useStoryRequestScope(`${projectId}:${runId}`);
  const [previousIdentity, setPreviousIdentity] = useState(identity);
  if (previousIdentity !== identity) {
    setPreviousIdentity(identity);
    setRun(null);
  }

  useEffect(() => {
    if (!identity.enabled || !projectOk || !runOk || !runId) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    void getStoryAgentRun(projectId, runId, controller.signal)
      .then((next) => {
        if (!cancelled) setRun(next);
      })
      .catch(() => {
        if (!cancelled) setRun(null);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [projectId, projectOk, runId, runOk, identity]);

  return run;
}
