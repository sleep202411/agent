/**
 * Image pipeline — generate via Replicate, land on our OSS.
 *
 * Replicate's prediction output URLs expire after 24h, so we MUST re-host.
 * The flow is:
 *   1. generateImage() → Uint8Array bytes (AI SDK buffers the download)
 *   2. Ask Java for a signed upload URL (/api/user/file/getUploadUrl)
 *   3. PUT the bytes to the signed URL
 *   4. Return the stable OSS storage path (extracted from signed URL)
 *
 * The role/scene/prop Java records get the path written to `roleImgPath[]`
 * / equivalent via a separate update call — that's the queue worker's job,
 * not this module's.
 */
import { experimental_generateImage as generateImage } from "ai";
import type { JSONValue } from "ai";
import { javaRequest, type StoryosContext } from "./workspace-client";
import { getImageModel } from "./replicate";

type UploadUrlResponse = {
  url?: string;
  headers?: Record<string, string>;
  method?: string;
  path?: string;
  [key: string]: unknown;
};

/**
 * Ephemeral Replicate image → stable OSS path.
 *
 * @returns The OSS storage path that can be stored in Java records and later
 *          resolved to a public URL by frontend via `buildOssUrl(path)`.
 */
export async function generateAndStoreImage(
  ctx: StoryosContext,
  opts: {
    prompt: string;
    uploadType: string; // e.g. "WORLD" / "ROLE" — tells Java which bucket folder
    fileNameHint: string; // e.g. "role-123-main.webp" — purely descriptive
    /** Extra inference knobs for Replicate (e.g. num_inference_steps). */
    providerOptions?: Record<string, JSONValue>;
  }
): Promise<string> {
  // 1. Replicate generates the image and AI SDK downloads the bytes for us.
  const { image } = await generateImage({
    model: getImageModel(),
    prompt: opts.prompt,
    providerOptions: {
      replicate: (opts.providerOptions ?? {}) as Record<string, JSONValue>,
    },
  });

  const bytes = image.uint8Array;
  if (bytes.length === 0) {
    throw new Error("Replicate returned empty image bytes");
  }

  // 2. Ask Java for a signed upload URL. Java owns bucket routing + ACLs.
  const uploadInfo = await javaRequest<UploadUrlResponse>(ctx, "/api/user/file/getUploadUrl", {
    data: {
      fileName: opts.fileNameHint,
      uploadType: opts.uploadType,
    },
  });

  if (!uploadInfo.url) {
    throw new Error(
      `Java /getUploadUrl returned no url (response: ${JSON.stringify(uploadInfo).slice(0, 200)})`
    );
  }

  // 3. Upload bytes to OSS via the signed URL. Replicate returns webp/png
  // depending on model; FLUX schnell is webp. The Content-Type must match
  // what OSS signed — we trust Java's headers map, fall back to image/webp.
  // Wrap the Uint8Array in a Blob so the fetch() body typing matches (raw
  // Uint8Array isn't a valid BodyInit in strict TS lib.dom.d.ts).
  const response = await fetch(uploadInfo.url, {
    method: uploadInfo.method ?? "PUT",
    headers: {
      "Content-Type": "image/webp",
      ...(uploadInfo.headers ?? {}),
    },
    body: new Blob([new Uint8Array(bytes)], { type: "image/webp" }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `OSS PUT failed: ${response.status} ${response.statusText} ${body.slice(0, 200)}`
    );
  }

  // 4. Extract the storage path. Java usually returns it in the `path`
  // field; if not, fall back to the URL's pathname.
  const storagePath =
    typeof uploadInfo.path === "string" && uploadInfo.path.length > 0
      ? uploadInfo.path
      : extractPathFromUrl(uploadInfo.url);

  return storagePath;
}

function extractPathFromUrl(signedUrl: string): string {
  try {
    const url = new URL(signedUrl);
    return url.pathname.replace(/^\//, "");
  } catch {
    return signedUrl;
  }
}
