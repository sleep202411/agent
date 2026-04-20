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
  aspectRatio: string;
}): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    // Hard fallback when DeepSeek is unavailable. Not great, but keeps the
    // tool working in local dev without LLM keys.
    const snippet = opts.script?.slice(0, 200).replace(/\s+/g, " ").trim();
    return [
      "cinematic movie poster",
      opts.aspectRatio,
      "dramatic composition, high detail, no text, no watermark",
      snippet ? `scene inspiration: ${snippet}` : null,
      opts.projectName ? `title: "${opts.projectName}"` : null,
    ]
      .filter(Boolean)
      .join(", ");
  }

  const userMsg = [
    "请根据下面素材，生成 1 句英文图像生成提示词（≤ 60 词）用于 Flux 模型生成电影海报风格封面：",
    `- 画幅：${opts.aspectRatio}`,
    opts.projectName ? `- 项目名：${opts.projectName}` : null,
    opts.script ? `- 剧本开头片段：\n${opts.script.slice(0, 1200)}` : "- 暂无剧本内容",
    "",
    "要求：全英文；只出 1 句 prompt 本身，不要解释、不要引号、不要 markdown；cinematic、dramatic、不要让模型画出文字/logo/watermark。",
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
    "为当前项目自动生成一张 AI 封面图并落库到 project.imagePath。supervisor 在 mark_project_params_updated 之后**总是**调用；Tool 内部会自己检查项目是否已有封面（幂等）。不消耗用户积分。如果用户本轮消息附带了剧本 att_ 引用，请把 textRef 传过来，生成的封面会更贴剧本。",
  inputSchema: z.object({
    textRef: z
      .string()
      .optional()
      .describe(
        "如果当前轮 user 消息的 attachments 里有 att_xxx 引用（和你传给 story_outline 的 textRef 一致），把它传进来。没有就不传。"
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

    const script = await resolveScriptText(textRef);
    const aspectRatio = aspectRatioFromType(detail.aspectRatioType);
    const imagePrompt = await writeCoverPrompt({
      script,
      projectName: detail.name ?? null,
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
