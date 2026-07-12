import { mkdir } from "node:fs/promises";
import path from "node:path";
import { RunnerError } from "./errors";
import { writeStreamToPartFile, type StoredImage, type SupportedImageFormat } from "./image-file";

const ALLOWED_OUTPUT_HOST_SUFFIXES = [
  ".bytepluses.com",
  ".bytepluscdn.com",
  ".volces.com",
] as const;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SecureDownloadOptions {
  destinationPath: string;
  expectedFormat?: SupportedImageFormat;
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

export async function secureDownloadProviderImage(
  sourceUrl: string,
  options: SecureDownloadOptions
): Promise<StoredImage> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxRedirects = options.maxRedirects ?? 3;
  const deadline = Date.now() + timeoutMs;
  let current = assertAllowedProviderOutputUrl(sourceUrl);

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new RunnerError("DOWNLOAD_FAILED", "Provider output download timed out.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs);
    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "image/png,image/jpeg,image/webp" },
        signal: controller.signal,
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirects === maxRedirects) {
          throw new RunnerError("DOWNLOAD_FAILED", "Provider output exceeded redirect limit.");
        }
        const location = response.headers.get("location");
        if (!location)
          throw new RunnerError("DOWNLOAD_FAILED", "Provider redirect omitted Location.");
        await response.body?.cancel().catch(() => undefined);
        current = assertAllowedProviderOutputUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) {
        throw new RunnerError(
          "DOWNLOAD_FAILED",
          "Provider output URL returned a non-success status.",
          {
            httpStatus: response.status,
          }
        );
      }
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
        throw new RunnerError("DOWNLOAD_FAILED", "Provider output exceeds declared size limit.");
      }
      if (!response.body) throw new RunnerError("DOWNLOAD_FAILED", "Provider output had no body.");
      await mkdir(path.dirname(options.destinationPath), { recursive: true });
      return await writeStreamToPartFile({
        stream: response.body,
        destinationPath: options.destinationPath,
        ...(options.expectedFormat ? { expectedFormat: options.expectedFormat } : {}),
        responseContentType: response.headers.get("content-type"),
        maxBytes: options.maxBytes,
      });
    } catch (error) {
      if (error instanceof RunnerError) throw error;
      throw new RunnerError(
        "DOWNLOAD_FAILED",
        "Provider output download failed before completion."
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw new RunnerError("DOWNLOAD_FAILED", "Provider output download did not resolve.");
}

export function assertAllowedProviderOutputUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RunnerError("SECURITY_REJECTED", "Provider output URL is invalid.");
  }
  const hostname = url.hostname.toLowerCase();
  const hostAllowed = ALLOWED_OUTPUT_HOST_SUFFIXES.some(
    (suffix) => hostname.endsWith(suffix) && hostname.length > suffix.length
  );
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !hostAllowed
  ) {
    throw new RunnerError(
      "SECURITY_REJECTED",
      "Provider output URL is not an allowlisted BytePlus HTTPS host."
    );
  }
  url.hash = "";
  return url.toString();
}
