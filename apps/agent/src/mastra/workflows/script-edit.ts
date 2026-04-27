/**
 * script_edit workflow — rewrite an episode's script text based on the user's
 * edit intent, then HITL-confirm before saving to Java.
 *
 * Flow:
 *   fetch_current    — read existing script from Java
 *   generate_edit    — LLM (scriptwriter persona) rewrites
 *   collect_draft    — store revised text as a draft
 *   wait_confirmation — HITL
 *   apply_decision   — save to Java via episode-script upsert, or discard
 */
import { randomUUID } from "node:crypto";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  deleteAllDrafts,
  getDraft,
  markDraftCommitted,
  markDraftCommitting,
  markDraftDiscarded,
  markDraftFailed,
  putDraft,
} from "../lib/drafts";
import { reportProgress, throwIfCancelled } from "./engine";
import { getContext, javaRequest, type StoryosContext } from "../lib/workspace-client";

// ─── Schemas ───────────────────────────────────────────────────────────

const InputSchema = z.object({
  episodeId: z.string().min(1),
  userEdit: z.string().min(1, "Edit instruction is required"),
});

const OutputSchema = z.object({
  outcome: z.enum(["committed", "rejected", "failed"]),
  episodeId: z.string(),
  clientRefId: z.string().optional(),
  message: z.string(),
});

const StateSchema = z.object({
  original: z.string().default(""),
  revised: z.string().default(""),
  draftClientRefId: z.string().optional(),
});

const ResumeSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().optional(),
});

const SuspendSchema = z.object({
  runId: z.string(),
  episodeId: z.string(),
  originalLength: z.number(),
  revisedLength: z.number(),
  clientRefId: z.string(),
});

// ─── Java integration helpers ──────────────────────────────────────────

async function fetchEpisodeScript(ctx: StoryosContext, episodeId: string): Promise<string> {
  const resp = await javaRequest<{ content?: string } | null>(
    ctx,
    `/api/user/project/scripts/episode/detail/${episodeId}`
  );
  return (resp as { content?: string } | null)?.content ?? "";
}

async function saveEpisodeScript(
  ctx: StoryosContext,
  episodeId: string,
  content: string
): Promise<void> {
  await javaRequest<unknown>(ctx, "/api/user/project/scripts/episode/createOrUpdate", {
    data: { episodeId, content },
    timeoutMs: 120_000,
  });
}

// ─── Step 1: fetch_current ────────────────────────────────────────────

const fetchCurrentStep = createStep({
  id: "fetch_current",
  inputSchema: InputSchema,
  outputSchema: z.object({ originalLength: z.number() }),
  stateSchema: StateSchema,
  execute: async ({ inputData, setState, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing from requestContext");
    await throwIfCancelled(runId);

    const ctx = getContext(requestContext);
    await reportProgress(runId, {
      stepId: "fetch_current",
      current: 0,
      total: 3,
      label: "Loading current script…",
    });

    const original = await fetchEpisodeScript(ctx, inputData.episodeId);
    setState({ original, revised: "" });

    await reportProgress(runId, {
      stepId: "fetch_current",
      current: 1,
      total: 3,
      label: `Script loaded (${original.length} chars)`,
    });
    return { originalLength: original.length };
  },
});

// ─── Step 2: generate_edit ────────────────────────────────────────────

const generateEditStep = createStep({
  id: "generate_edit",
  inputSchema: z.object({ originalLength: z.number() }),
  outputSchema: z.object({ revisedLength: z.number() }),
  stateSchema: StateSchema,
  execute: async ({ state, setState, mastra, requestContext, getInitData }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing from requestContext");
    await throwIfCancelled(runId);

    const input = getInitData<z.infer<typeof InputSchema>>();

    const scriptwriter = mastra?.getAgent("scriptwriter");
    if (!scriptwriter) throw new Error("scriptwriter agent not registered");

    await reportProgress(runId, {
      stepId: "generate_edit",
      current: 1,
      total: 3,
      label: "Scriptwriter is revising the script…",
    });

    const original = state.original ?? "";
    const prompt = buildEditPrompt(original, input.userEdit);

    // Request structured output so we get the rewritten text cleanly.
    const response = await scriptwriter.generate(prompt, {
      structuredOutput: {
        schema: z.object({ revised: z.string().min(1) }),
        errorStrategy: "warn",
      },
    });
    const obj = response.object as { revised?: string } | undefined;
    const revised = (obj?.revised ?? response.text ?? "").trim();

    if (!revised || revised === original) {
      throw new Error("scriptwriter returned empty or unchanged script — nothing to commit");
    }

    setState({ original, revised });
    await reportProgress(runId, {
      stepId: "generate_edit",
      current: 2,
      total: 3,
      label: `Revised version generated (${revised.length} chars)`,
    });
    return { revisedLength: revised.length };
  },
});

function buildEditPrompt(original: string, userEdit: string): string {
  return [
    "Below is the current script in full:",
    "",
    "```",
    original,
    "```",
    "",
    "User's revision notes:",
    userEdit,
    "",
    "Output language: default English. If the project context provides a `dialogLanguage` (or equivalent locale param), follow it for the rewritten script.",
    "",
    "Output the **complete** revised script. Return JSON; the `revised` field holds the entire revised script text.",
  ].join("\n");
}

// ─── Step 3: collect_draft ────────────────────────────────────────────

const collectDraftStep = createStep({
  id: "collect_draft",
  inputSchema: z.object({ revisedLength: z.number() }),
  outputSchema: z.object({ clientRefId: z.string() }),
  stateSchema: StateSchema,
  execute: async ({ state, setState, requestContext, getInitData }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing from requestContext");
    await throwIfCancelled(runId);

    const input = getInitData<z.infer<typeof InputSchema>>();
    const clientRefId = randomUUID();
    const revised = state.revised ?? "";

    await putDraft(runId, "script", clientRefId, {
      episodeId: input.episodeId,
      content: revised,
      // Persist the pre-edit text so the UI can show a diff — the draft
      // store is opaque JSON, this is a workflow-specific shape.
      original: state.original ?? "",
    });

    setState({ ...state, draftClientRefId: clientRefId });
    return { clientRefId };
  },
});

// ─── Step 4: wait_confirmation ────────────────────────────────────────

const waitConfirmationStep = createStep({
  id: "wait_confirmation",
  inputSchema: z.object({ clientRefId: z.string() }),
  outputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
    clientRefId: z.string(),
  }),
  stateSchema: StateSchema,
  resumeSchema: ResumeSchema,
  suspendSchema: SuspendSchema,
  execute: async ({ inputData, resumeData, suspend, state, requestContext, getInitData }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing from requestContext");

    if (!resumeData) {
      const input = getInitData<z.infer<typeof InputSchema>>();
      await reportProgress(runId, {
        stepId: "wait_confirmation",
        current: 2,
        total: 3,
        label: "Script revision draft ready for review",
      });
      return await suspend({
        runId,
        episodeId: input.episodeId,
        originalLength: (state.original ?? "").length,
        revisedLength: (state.revised ?? "").length,
        clientRefId: inputData.clientRefId,
      });
    }

    return {
      approved: resumeData.approved,
      feedback: resumeData.feedback,
      clientRefId: inputData.clientRefId,
    };
  },
});

// ─── Step 5: apply_decision ───────────────────────────────────────────

const applyDecisionStep = createStep({
  id: "apply_decision",
  inputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
    clientRefId: z.string(),
  }),
  outputSchema: OutputSchema,
  stateSchema: StateSchema,
  execute: async ({ inputData, requestContext, getInitData }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing from requestContext");
    await throwIfCancelled(runId);

    const ctx = getContext(requestContext);
    const input = getInitData<z.infer<typeof InputSchema>>();

    if (!inputData.approved) {
      await markDraftDiscarded(runId, inputData.clientRefId);
      await reportProgress(runId, {
        stepId: "apply_decision",
        current: 0,
        total: 1,
        label: "User rejected — revisions discarded",
      });
      return {
        outcome: "rejected" as const,
        episodeId: input.episodeId,
        message: inputData.feedback
          ? `User rejected. Feedback: ${inputData.feedback}`
          : "User rejected the revision.",
      };
    }

    const draft = await getDraft<{ episodeId: string; content: string }>(
      runId,
      inputData.clientRefId
    );
    if (!draft) {
      throw new Error(`draft ${inputData.clientRefId} not found — it may have expired`);
    }

    await markDraftCommitting(runId, inputData.clientRefId);
    await reportProgress(runId, {
      stepId: "apply_decision",
      current: 0,
      total: 1,
      label: "Saving to episode…",
    });

    try {
      await saveEpisodeScript(ctx, draft.data.episodeId, draft.data.content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markDraftFailed(runId, inputData.clientRefId, message);
      return {
        outcome: "failed" as const,
        episodeId: input.episodeId,
        clientRefId: inputData.clientRefId,
        message: `Save failed: ${message}`,
      };
    }

    await markDraftCommitted(runId, inputData.clientRefId, draft.data.episodeId);
    await deleteAllDrafts(runId);
    await reportProgress(runId, {
      stepId: "apply_decision",
      current: 1,
      total: 1,
      label: "Saved",
    });

    return {
      outcome: "committed" as const,
      episodeId: input.episodeId,
      clientRefId: inputData.clientRefId,
      message: `Saved revised script to episode ${input.episodeId}.`,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const scriptEditWorkflow = createWorkflow({
  id: "script_edit",
  description:
    "Rewrite one episode's script based on the user's revision notes; save after human confirmation.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  stateSchema: StateSchema,
})
  .then(fetchCurrentStep)
  .then(generateEditStep)
  .then(collectDraftStep)
  .then(waitConfirmationStep)
  .then(applyDecisionStep)
  .commit();
