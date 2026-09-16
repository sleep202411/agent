export async function downloadBlob(url: string, fileName: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const response = await fetch(url, { signal });
  if (!response.ok) {
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

export async function downloadBatch(
  assets: { url: string; name: string }[],
  signal?: AbortSignal
): Promise<boolean> {
  let successful = true;
  for (const asset of assets) {
    try {
      signal?.throwIfAborted();
      await downloadBlob(asset.url, asset.name, signal);
    } catch (error) {
      signal?.throwIfAborted();
      successful = false;
      console.error("[StoryboardColumnHeader] Download failed:", error);
    }
  }
  return successful;
}
