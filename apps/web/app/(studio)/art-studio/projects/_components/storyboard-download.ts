export async function downloadBlob(url: string, fileName: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const response = await fetch(url, { signal });
  if (!response.ok) {
    // A failed response can still carry a streaming body. Releasing it must
    // not replace the original HTTP error when cancellation itself fails.
    try {
      await response.body?.cancel();
    } catch {
      /* Preserve HTTP status. */
    }
    throw new Error(`HTTP ${response.status}`);
  }
  const blob = await response.blob();
  signal?.throwIfAborted();
  const downloadUrl = URL.createObjectURL(blob);
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor?.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  }
}

export function batchAssetName(path: string, index: number, type: "image" | "video") {
  const pathname = path.split(/[?#]/, 1)[0] ?? "";
  const extension = /\.([a-z0-9]{1,10})$/i.exec(pathname)?.[1];
  return `shot_${index + 1}_final.${extension || (type === "image" ? "png" : "mp4")}`;
}

export interface BatchDownloadReport {
  /** Initiation is observable; browser disk persistence is not. */
  items: { index: number; name: string; status: "initiated" | "failed" }[];
  initiated: number;
  failed: number;
}

/** Explicit result data for caller-owned recovery; no retries or URL retention. */
export async function downloadBatchWithReport(
  assets: { url: string; name: string }[],
  signal?: AbortSignal
): Promise<BatchDownloadReport> {
  signal?.throwIfAborted();
  // Do not let a caller's edits change the meaning of an already-started batch.
  const requested = assets.map(({ url, name }) => ({ url, name }));
  const items: BatchDownloadReport["items"] = [];
  for (const [index, asset] of requested.entries()) {
    try {
      signal?.throwIfAborted();
      await downloadBlob(asset.url, asset.name, signal);
      items.push({ index, name: asset.name, status: "initiated" });
    } catch (error) {
      signal?.throwIfAborted();
      items.push({ index, name: asset.name, status: "failed" });
      console.error("[StoryboardColumnHeader] Download failed:", error);
    }
  }
  const initiated = items.filter((item) => item.status === "initiated").length;
  return { items, initiated, failed: items.length - initiated };
}

export async function downloadBatch(
  assets: { url: string; name: string }[],
  signal?: AbortSignal
): Promise<boolean> {
  const report = await downloadBatchWithReport(assets, signal);
  return report.failed === 0;
}
