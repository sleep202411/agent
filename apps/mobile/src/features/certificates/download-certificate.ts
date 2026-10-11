import { streamFetch } from "@/lib/stream-fetch";
import { publicCertificateImage } from "./creator-certificates-api";
import { isCertificateNumber } from "./verify-api";
export type CertificateDownload = { bytes: Uint8Array; filename: string; mimeType: string };
const MAX_BYTES = 20 * 1024 * 1024;
export async function downloadCertificate(
  url: string,
  certNo: string,
  signal: AbortSignal
): Promise<CertificateDownload> {
  if (!publicCertificateImage(url) || !isCertificateNumber(certNo))
    throw new Error("Invalid certificate download.");
  signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("Certificate download timed out.")),
    60000
  );
  try {
    const response = await streamFetch(url, { signal: controller.signal, credentials: "omit" });
    controller.signal.throwIfAborted();
    if (!response.ok) throw new Error(`Certificate download failed (${response.status}).`);
    const mimeType = (response.headers.get("content-type") ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    if (!/^image\/[a-z0-9.+-]+$/.test(mimeType))
      throw new Error("Certificate response is not an image.");
    if (Number(response.headers.get("content-length")) > MAX_BYTES)
      throw new Error("Certificate image exceeds 20 MB.");
    if (!response.body) throw new Error("Certificate download body is missing.");
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        controller.signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error("Certificate image exceeds 20 MB.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (!size) throw new Error("Certificate image is empty.");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const extensions: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/svg+xml": "svg",
      "image/avif": "avif",
      "image/heic": "heic",
      "image/tiff": "tiff",
      "image/bmp": "bmp",
    };
    return { bytes, filename: `${certNo}.${extensions[mimeType] ?? "img"}`, mimeType };
  } finally {
    controller.abort();
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
