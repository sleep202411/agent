/**
 * IP-feature-private file uploads — semantic helpers.
 *
 * Each public export names *what* the caller is uploading (an episode
 * video, an episode cover, an IP banner …), never *how*. The wire
 * detail (which backend endpoint, which `uploadType` flag, what body
 * shape) is encapsulated inside this file. When the backend ships
 * dedicated episode upload endpoints, only the internal `getXxxUrl`
 * helper bodies move — public signatures and call sites stay put.
 *
 * The two-step pipeline (request signed URL → PUT bytes to OSS) is
 * duplicated here on purpose, per the AGENTS.md rule: feature-private
 * wins over reaching into a shared `src/lib/uploads/*`. If a second
 * feature later needs a similar uploader, it should redefine its own
 * — duplication is cheaper than coupling our IP flow to a helper that
 * could evolve out from under us.
 */

import { acceptLanguage, bearerHeader } from "./shared";

interface SignedUrlResponse {
  url?: string;
  headers?: Record<string, string>;
  method?: string;
  /**
   * OSS storage key the backend has decided to write the file under.
   * Authoritative — when present, prefer this over deriving the key from
   * the signed URL's pathname (decoding rules / custom prefixes can
   * differ from what backend persists in DB).
   */
  path?: string;
}

export interface UploadedAsset {
  /** OSS storage key, persists in DB. */
  path: string;
  name: string;
  size: number;
  mimeType: string;
}

// ─── Internal helpers ──────────────────────────────────

async function requestSignedUrl(
  endpoint: string,
  query: Record<string, string | number | undefined>
): Promise<SignedUrlResponse> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const url = qs.toString() ? `${endpoint}?${qs.toString()}` : endpoint;
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
  });
  if (!res.ok) throw new Error(`getUploadUrl failed: HTTP ${res.status}`);
  const json = (await res.json()) as {
    code?: number | string;
    msg?: string;
    message?: string;
    success?: boolean;
    data?: SignedUrlResponse;
    /**
     * Some endpoints surface the OSS storage key at envelope-level
     * alongside `code` / `msg` (instead of nesting inside `data`).
     * Prefer it when present — it's the value backend will recognize
     * on subsequent reads (avoids any URL-encoding round-trip risk).
     */
    path?: string;
  };
  // Envelope varies across endpoints: the IP banner endpoint returns
  // `{code: 200, msg, data}`; older Java endpoints return
  // `{success: true, code: "0", message, data}`. Accept either as OK.
  const codeNum = typeof json.code === "string" ? Number(json.code) : json.code;
  const ok = json.success === true || codeNum === 0 || codeNum === 200;
  if (!ok) {
    throw new Error(json.message || json.msg || "getUploadUrl failed");
  }
  const data = json.data ?? {};
  // Lift envelope-level `path` into the SignedUrlResponse so callers
  // get a single shape regardless of where the backend put it.
  return typeof json.path === "string" && json.path && !data.path
    ? { ...data, path: json.path }
    : data;
}

function extractStoragePath(signedUrl: string): string {
  const url = new URL(signedUrl);
  // Pathname comes URL-encoded (`%20`, `%E2%80%A6`); decode so the key we
  // persist matches what the backend sees (`13/My Banner.png` vs.
  // `13/My%20Banner.png`). Wrap the decode so a malformed input doesn't
  // crash the upload.
  const raw = url.pathname.replace(/^\//, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function putBytesToOss(info: SignedUrlResponse, file: File): Promise<string> {
  if (!info.url) throw new Error("Upload URL missing");
  const res = await fetch(info.url, {
    method: info.method ?? "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      ...(info.headers ?? {}),
    },
    body: file,
  });
  if (!res.ok) {
    // Read OSS's XML error body so we can see <Code>/<Message>/
    // <StringToSign> in the console — DevTools' Network → Response
    // panel evicts the body once the request scrolls off, and without
    // the XML there's no way to tell SignatureDoesNotMatch apart from
    // InvalidArgument apart from RequestTimeTooSkewed.
    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {
      /* response body unreadable — keep the empty string */
    }
    // eslint-disable-next-line no-console
    console.error(
      `[uploads] OSS PUT ${res.status} ${res.statusText}\nURL: ${info.url}\nBody:\n${bodyText}`
    );
    throw new Error(
      bodyText
        ? `OSS upload failed: HTTP ${res.status} — ${extractOssErrorMessage(bodyText, res.status)}`
        : `OSS upload failed: HTTP ${res.status}`
    );
  }
  // Backend's authoritative storage key wins over our URL-derived guess
  // — that's what the rest of the system (DB persistence, /vedio/play
  // /getLink resolution) expects to see.
  return info.path && info.path.length > 0 ? info.path : extractStoragePath(info.url);
}

/**
 * Pull the human-meaningful pieces out of OSS's error XML so the toast
 * the user sees says something more useful than "HTTP 400". Falls back
 * to the raw body when the XML doesn't parse — which means the upload
 * helper's caller still gets *something* to display.
 */
function extractOssErrorMessage(xml: string, status: number): string {
  const code = /<Code>([^<]+)<\/Code>/i.exec(xml)?.[1];
  const message = /<Message>([^<]+)<\/Message>/i.exec(xml)?.[1];
  if (code && message) return `${code}: ${message}`;
  if (code) return code;
  if (message) return message;
  return `HTTP ${status}`;
}

function composeResult(file: File, path: string): UploadedAsset {
  return { path, name: file.name, size: file.size, mimeType: file.type };
}

/**
 * Build a unique, ASCII-only filename to send to backend's presigned-URL
 * endpoint. Replaces whatever the user originally named the file.
 *
 * Why not keep the original name: OSS V4 signing on a custom-domain
 * endpoint percent-encodes the object key under OSS's strict rules
 * (`%20` for space, lowercase hex). Backends frequently encode using
 * a different convention — Java's `URLEncoder.encode` writes `+` for
 * space, default URI encoders may leave Chinese alone, etc. When
 * backend's canonical key doesn't match OSS's canonical key, the V4
 * signature validates against the wrong StringToSign and OSS returns
 * 403 `SignatureDoesNotMatch`. Confirmed in prod: ASCII-only
 * `1777541432954.mp4` succeeded; `ChatGPT Image 2026年4月30日.png`
 * (spaces + Chinese) failed. Stripping the original name out of the
 * picture entirely sidesteps the entire encoding-mismatch family.
 *
 * Prefix + timestamp + uuid keeps keys grep-able when triaging
 * production OSS objects ("which feature wrote this?" / "when?"),
 * without coupling the storage layer to user-supplied strings. The
 * user-visible `file.name` (UI cards, helpers) is unaffected — only
 * the wire value handed to backend / persisted as the OSS key changes.
 */
function uniqueUploadName(prefix: string, originalName: string): string {
  const dot = originalName.lastIndexOf(".");
  const rawExt = dot > 0 ? originalName.slice(dot + 1).toLowerCase() : "";
  // Cap + sanitize the extension so a malicious / weird input can't
  // smuggle non-ASCII back in via the `.foo` portion.
  const ext = rawExt.replace(/[^a-z0-9]/g, "").slice(0, 8);
  const uuid = (
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  )
    .replace(/-/g, "")
    .slice(0, 12);
  const stem = `${prefix}_${Date.now()}_${uuid}`;
  return ext ? `${stem}.${ext}` : stem;
}

// ─── Public uploaders ──────────────────────────────────
//
// IP banner + episode video each have their own dedicated presigned-URL
// endpoint (`/vedio/getuploadurl/project/banner` / `…/project/video/`),
// both scoped to a project (and optionally an existing video) via query
// params. Episode cover still rides the legacy generic uploader.

interface UploadEpisodeVideoInput {
  /** Project this episode belongs to (required). */
  projectId: number | string;
  /** Existing episode/video id when re-uploading; omit on first upload. */
  videoId?: number | string;
}

/** Episode source video. */
export async function uploadEpisodeVideo(
  file: File,
  input: UploadEpisodeVideoInput
): Promise<UploadedAsset> {
  const info = await requestSignedUrl("/vedio/getuploadurl/project/video", {
    fileName: uniqueUploadName("ep_video", file.name),
    projectId: input.projectId,
    videoId: input.videoId,
  });
  const path = await putBytesToOss(info, file);
  return composeResult(file, path);
}

interface UploadEpisodeCoverInput {
  /** Project this episode belongs to (required by backend). */
  projectId: number | string;
  /** Episode/video id when re-uploading the cover of an existing episode;
   *  omit on the create flow (banner is project-scoped until the episode
   *  itself gets a serverId on Save). */
  videoId?: number | string;
}

/**
 * Shared backend-proxied banner uploader. POSTs the file as
 * multipart/form-data to `/vedio/upload/banner`; backend handles the
 * OSS hop and returns the storage key. Sidesteps the OSS V4 +
 * custom-domain SignatureDoesNotMatch issues that the presigned-URL
 * path keeps tripping on; the tradeoff is the file streams through
 * the Java service before landing in OSS. Used for both episode
 * covers and IP-level banners — same backend endpoint, the only
 * difference is the storage key prefix surfaced for telemetry /
 * grep-ability.
 */
async function uploadBannerImage(file: File, namePrefix: string): Promise<UploadedAsset> {
  // Rename the File on the wire so the backend's storage key stays
  // ASCII-safe (mirrors the presigned path's protections — `年`/spaces
  // in filenames have historically tripped the upload chain).
  const safeName = uniqueUploadName(namePrefix, file.name);
  const renamedFile = new File([file], safeName, {
    type: file.type,
    lastModified: file.lastModified,
  });
  const form = new FormData();
  form.append("file", renamedFile);
  const path = await postMultipartUpload("/vedio/upload/banner", form);
  return composeResult(file, path);
}

/** Episode cover image. */
export async function uploadEpisodeCover(
  file: File,
  _input: UploadEpisodeCoverInput
): Promise<UploadedAsset> {
  return uploadBannerImage(file, "ep_cover");
}

/**
 * Backend-proxied multipart upload for endpoints that take the file
 * directly (vs. handing back a presigned OSS URL). Returns the OSS
 * storage key the backend persisted.
 *
 * Response contract: `{ path: "..." }`. Success is signaled by the
 * presence of `path`; there's no `code` / `msg` envelope on this
 * endpoint, so HTTP status + `path` are the only success signals.
 */
async function postMultipartUpload(endpoint: string, form: FormData): Promise<string> {
  const res = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers: {
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
      // NOTE: do NOT set Content-Type — fetch needs to compute the
      // multipart boundary itself, and a hard-coded value here would
      // break the request body framing.
    },
    body: form,
  });
  if (!res.ok) {
    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {
      /* unreadable */
    }
    // eslint-disable-next-line no-console
    console.error(
      `[uploads] multipart POST ${endpoint} ${res.status} ${res.statusText}\nBody:\n${bodyText}`
    );
    throw new Error(`upload failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { path?: string };
  if (!json.path) {
    throw new Error("upload succeeded but backend returned no storage path");
  }
  return json.path;
}

interface UploadIPBannerInput {
  /** Kept for forward-compat; backend's `/vedio/upload/banner` doesn't
   *  consume it today, but callers that already pass it shouldn't be
   *  forced to drop the value. The project linkage happens later in
   *  the project-update call when the page persists `bannerLink`. */
  projectId?: number | string;
  /** Same forward-compat note as `projectId`. */
  videoId?: number | string;
}

/**
 * IP-level banner (cover image used on the plaza card and detail hero).
 * Persisted via the project-update endpoint as `bannerLink` after this
 * helper returns the storage path.
 */
export async function uploadIPBanner(
  file: File,
  _input?: UploadIPBannerInput
): Promise<UploadedAsset> {
  return uploadBannerImage(file, "ip_banner");
}
