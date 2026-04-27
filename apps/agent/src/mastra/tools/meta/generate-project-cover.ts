/**
 * Tool: generate_project_cover
 *
 * Called by supervisor after mark_project_params_updated. Builds a
 * Flux-schnell prompt from (optional) script excerpt + project style/aspect,
 * generates a cover via Replicate, downloads, uploads to OSS through Java's
 * signed-PUT path, and writes the resulting storage path back to
 * project.imagePath.
 *
 * - No user credits: Replicate is billed to the platform directly via
 *   REPLICATE_API_TOKEN. Java-gated image generation (/api/ai/image/...)
 *   which would consume credits is NOT used here.
 * - Idempotent: if project.imagePath is already set, returns early with
 *   {skipped: true}. Supervisor can safely always call this after params.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getRedis } from "../../lib/redis-client";
import { getContext, javaRequest } from "../../lib/workspace-client";

// ─── Types ────────────────────────────────────────────

type ProjectDetailLite = {
  id?: string;
  worldId?: string;
  imagePath?: string | null;
  name?: string | null;
  description?: string | null;
  aspectRatioType?: string | null;
  stylePainting?: string | null;
  type?: number | null;
  episode?: number | null;
  chapterLength?: number | null;
  dialogLanguage?: string | null;
  [k: string]: unknown;
};

type UploadUrlResponse = {
  url?: string;
  headers?: Record<string, string>;
  method?: string;
};

type ReplicatePrediction = {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled" | string;
  output?: string | string[] | null;
  error?: string | null;
};

// ─── Helpers ──────────────────────────────────────────

function aspectRatioFromType(type: string | null | undefined): string {
  if (!type) return "16:9";
  const m = type.match(/_(\d+)_(\d+)/);
  return m ? `${m[1]}:${m[2]}` : "16:9";
}

type WorldDetailLite = {
  id?: string;
  description?: string | null;
  core?: string | null;
};

type PaintingStyle = {
  id?: string | number;
  info?: string | null;
};

/**
 * Resolve the project's world.core (concrete visual imagery) so we can
 * feed it into the Flux prompt as "key visuals". Failure is non-fatal —
 * fall back to no core.
 */
async function resolveWorldCore(
  ctx: ReturnType<typeof getContext>,
  worldId: string | null | undefined
): Promise<{ description: string | null; core: string | null }> {
  if (!worldId) return { description: null, core: null };
  try {
    const world = await javaRequest<WorldDetailLite>(
      ctx,
      `/api/user/world/query/world?id=${worldId}`
    );
    return {
      description: typeof world.description === "string" ? world.description : null,
      core: typeof world.core === "string" ? world.core : null,
    };
  } catch (err) {
    console.warn("[generate_project_cover] world core lookup failed:", err);
    return { description: null, core: null };
  }
}

// In-process cache for the painting-styles dictionary — it never changes
// during a process lifetime, and the API call is a couple hundred ms.
let _styleCache: Map<string, string> | null = null;

async function loadPaintingStyles(
  ctx: ReturnType<typeof getContext>
): Promise<Map<string, string>> {
  if (_styleCache) return _styleCache;
  try {
    const list = await javaRequest<PaintingStyle[]>(
      ctx,
      "/api/user/world/static/list/painting/style/",
      { method: "GET" }
    );
    const out = new Map<string, string>();
    for (const item of list ?? []) {
      if (item?.id != null && typeof item.info === "string" && item.info.length > 0) {
        out.set(String(item.id), item.info);
      }
    }
    _styleCache = out;
    return out;
  } catch (err) {
    console.warn("[generate_project_cover] painting-styles dict lookup failed:", err);
    return new Map();
  }
}

async function resolveStyleLabel(
  ctx: ReturnType<typeof getContext>,
  styleId: string | null | undefined
): Promise<string | null> {
  if (!styleId) return null;
  const dict = await loadPaintingStyles(ctx);
  return dict.get(String(styleId)) ?? null;
}

async function resolveScriptText(textRef: string | undefined): Promise<string | null> {
  if (!textRef || !textRef.startsWith("att_")) return null;
  try {
    const raw = await getRedis().get(`attachment:${textRef}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { text?: string };
    return typeof parsed.text === "string" ? parsed.text : null;
  } catch (err) {
    console.warn("[generate_project_cover] textRef resolve failed:", err);
    return null;
  }
}

async function writeCoverPrompt(opts: {
  script: string | null;
  projectName: string | null;
  description: string | null;
  core: string | null;
  styleLabel: string | null;
  aspectRatio: string;
}): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    // Hard fallback when DeepSeek is unavailable. Not great, but keeps the
    // tool working in local dev without LLM keys.
    const snippet = opts.script?.slice(0, 200).replace(/\s+/g, " ").trim();
    return [
      opts.styleLabel ? opts.styleLabel : "cinematic movie poster",
      opts.aspectRatio,
      "dramatic composition, high detail, no text, no watermark",
      opts.description ? `concept: ${opts.description}` : null,
      opts.core ? `key visuals: ${opts.core}` : null,
      snippet ? `scene inspiration: ${snippet}` : null,
      opts.projectName ? `title: "${opts.projectName}"` : null,
    ]
      .filter(Boolean)
      .join(", ");
  }

  // Feed everything we know about the project. The "core motifs" field
  // (concrete objects like "broken bridge, misty willows, paper umbrella")
  // matters most — it's what gives Flux something specific to draw.
  const userMsg = [
    "Using the material below, generate 1 English image-generation prompt (<= 60 words) for the Flux model to produce a cinematic movie-poster cover:",
    `- Aspect ratio: ${opts.aspectRatio}`,
    opts.projectName ? `- Project name: ${opts.projectName}` : null,
    opts.description ? `- One-sentence concept: ${opts.description}` : null,
    opts.core ? `- Core motifs (must appear concretely in frame): ${opts.core}` : null,
    opts.styleLabel ? `- Art style (render in this style): ${opts.styleLabel}` : null,
    opts.script
      ? `- Opening script excerpt:\n${opts.script.slice(0, 1200)}`
      : "- No script content available",
    "",
    "Requirements:",
    "- English only; output the prompt sentence itself, no explanation, no quotes, no markdown",
    "- The **core motifs** must literally appear in the image (concrete objects like 'broken bridge, paper umbrella')",
    "- The **art style** must be stated in the prompt (e.g. 'Chinese ink wash painting' / 'cyberpunk illustration')",
    "- cinematic, dramatic; do not let the model render text / logos / watermarks",
  ]
    .filter(Boolean)
    .join("\n");

  const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content:
            "You generate concise image prompts for Flux models. Reply in English only, 1 sentence, no explanation, no markdown, no surrounding quotes.",
        },
        { role: "user", content: userMsg },
      ],
      max_tokens: 180,
      temperature: 0.7,
    }),
  });
  if (!resp.ok) {
    throw new Error(`DeepSeek prompt gen failed: HTTP ${resp.status}`);
  }
  const body = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  return (
    text ||
    `cinematic movie poster, ${opts.aspectRatio}, dramatic composition, no text, no watermark`
  );
}

async function callReplicateFluxSchnell(
  apiToken: string,
  prompt: string,
  aspectRatio: string
): Promise<string> {
  // "Prefer: wait" blocks until the prediction finishes (up to ~60s). For
  // flux-schnell this usually returns in 2-4 seconds.
  const resp = await fetch(
    "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: {
          prompt,
          aspect_ratio: aspectRatio,
          num_outputs: 1,
          output_format: "webp",
          output_quality: 85,
        },
      }),
    }
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Replicate HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  const pred = (await resp.json()) as ReplicatePrediction;
  if (pred.status !== "succeeded") {
    throw new Error(`Replicate prediction ${pred.status}: ${pred.error ?? "unknown"}`);
  }
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (typeof out !== "string" || !out) {
    throw new Error("Replicate returned no output URL");
  }
  return out;
}

function extractStoragePathFromSignedUrl(signedUrl: string): string {
  const u = new URL(signedUrl);
  return u.pathname.replace(/^\//, "");
}

// ─── Tool ─────────────────────────────────────────────

export const generateProjectCover = createTool({
  id: "generate_project_cover",
  description:
    "Auto-generate an AI cover image for the current project and persist the path to project.imagePath. Supervisor **always** calls this after mark_project_params_updated; the tool checks internally whether a cover already exists (idempotent). Does not consume user credits. If the user's current message attached a script via an att_ ref, pass it as textRef so the generated cover stays closer to the script.",
  inputSchema: z.object({
    textRef: z
      .string()
      .optional()
      .describe(
        "Pass the same att_xxx ref you passed to story_outline if the current user message attached one. Omit otherwise."
      ),
  }),
  outputSchema: z.object({
    skipped: z.boolean().optional(),
    imagePath: z.string(),
    previewUrl: z.string().optional(),
  }),
  execute: async ({ textRef }, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    if (!replicateToken) {
      throw new Error("REPLICATE_API_TOKEN is not set in agent env");
    }

    const detail = await javaRequest<ProjectDetailLite>(
      ctx,
      `/api/user/project/detail/${ctx.projectId}`
    );
    if (detail.imagePath) {
      console.info("[generate_project_cover] skipped — have", detail.imagePath);
      return { skipped: true, imagePath: detail.imagePath };
    }

    const worldId = ctx.worldId ?? detail.worldId ?? null;
    const [script, worldInfo, styleLabel] = await Promise.all([
      resolveScriptText(textRef),
      resolveWorldCore(ctx, worldId),
      resolveStyleLabel(ctx, detail.stylePainting),
    ]);
    const aspectRatio = aspectRatioFromType(detail.aspectRatioType);

    // Project description lives on `detail`; world description/core live
    // on the world entity. Prefer project description first (set by
    // save_project_meta), fall back to world description if project's is
    // empty — the two fields are typically similar after analyze_brief.
    const description = detail.description ?? worldInfo.description ?? null;
    const core = worldInfo.core;

    const imagePrompt = await writeCoverPrompt({
      script,
      projectName: detail.name ?? null,
      description,
      core,
      styleLabel,
      aspectRatio,
    });
    console.info("[generate_project_cover] prompt:", imagePrompt.slice(0, 200));

    const coverRemoteUrl = await callReplicateFluxSchnell(replicateToken, imagePrompt, aspectRatio);
    console.info("[generate_project_cover] replicate →", coverRemoteUrl);

    const imgResp = await fetch(coverRemoteUrl);
    if (!imgResp.ok) {
      throw new Error(`Download cover failed: HTTP ${imgResp.status}`);
    }
    const bytes = new Uint8Array(await imgResp.arrayBuffer());
    const contentType = imgResp.headers.get("content-type") || "image/webp";

    const uploadInfo = await javaRequest<UploadUrlResponse>(ctx, "/api/user/file/getUploadUrl", {
      data: {
        fileName: `cover_${ctx.projectId}.webp`,
        uploadType: "WORLD",
      },
    });
    if (!uploadInfo.url) {
      throw new Error("Java getUploadUrl returned no url");
    }

    const putResp = await fetch(uploadInfo.url, {
      method: (uploadInfo.method || "PUT").toUpperCase(),
      headers: {
        "Content-Type": contentType,
        ...(uploadInfo.headers || {}),
      },
      body: bytes,
    });
    if (!putResp.ok) {
      const text = await putResp.text().catch(() => "");
      throw new Error(`OSS PUT failed: HTTP ${putResp.status} ${text.slice(0, 200)}`);
    }

    const storagePath = extractStoragePathFromSignedUrl(uploadInfo.url);
    console.info("[generate_project_cover] uploaded to OSS:", storagePath);

    await javaRequest(ctx, "/api/user/world/update/worldproduct", {
      data: {
        id: ctx.projectId,
        worldId: ctx.worldId ?? detail.worldId,
        name: detail.name,
        description: detail.description,
        type: detail.type,
        episode: detail.episode,
        imagePath: storagePath,
        aspectRatioType: detail.aspectRatioType,
        chapterLength: detail.chapterLength,
        stylePainting: detail.stylePainting,
        dialogLanguage: detail.dialogLanguage,
      },
    });
    console.info("[generate_project_cover] Java imagePath updated");

    return {
      imagePath: storagePath,
      previewUrl: coverRemoteUrl,
    };
  },
});
