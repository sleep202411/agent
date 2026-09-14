import { useEffect, useState } from "react";

import {
  getActiveStoryAgentRun,
  getStoryAgentRun,
  type StoryAgentRunDto,
} from "../api/story-agent-runs-api";
import { isAgentOsId } from "../lib/ids";

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
  const identity = `${projectId}:${chapterId}`;
  const [previousIdentity, setPreviousIdentity] = useState(identity);
  if (previousIdentity !== identity) {
    setPreviousIdentity(identity);
    setRun(null);
  }

  useEffect(() => {
    if (!projectOk || !chapterOk) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const next = await getActiveStoryAgentRun(projectId, chapterId);
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
      if (timer) clearTimeout(timer);
    };
  }, [agentBusy, chapterId, chapterOk, projectId, projectOk]);

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
  const identity = `${projectId}:${runId}`;
  const [previousIdentity, setPreviousIdentity] = useState(identity);
  if (previousIdentity !== identity) {
    setPreviousIdentity(identity);
    setRun(null);
  }

  useEffect(() => {
    if (!projectOk || !runOk || !runId) {
      return;
    }
    let cancelled = false;
    void getStoryAgentRun(projectId, runId)
      .then((next) => {
        if (!cancelled) setRun(next);
      })
      .catch(() => {
        if (!cancelled) setRun(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, projectOk, runId, runOk]);

  return run;
}
