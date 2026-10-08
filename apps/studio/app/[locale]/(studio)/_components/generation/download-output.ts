import { toast } from "sonner";
import { imageProxyTarget } from "@/lib/image-proxy-target";

/** Save only successful media responses. A user-initiated link remains available
 * when storage CORS rules prevent fetching an otherwise accessible original. */
export async function downloadOutput(
  source: string,
  name: string,
  labels: { failed: string; openOriginal: string }
): Promise<void> {
  try {
    let response: Response;
    try {
      response = await fetch(source);
    } catch (error) {
      // Images can display successfully while storage CORS blocks blob reads.
      if (!/\.(png|jpe?g|webp|gif|avif)$/i.test(name) || !imageProxyTarget(source)) throw error;
      response = await fetch(`/api/img?url=${encodeURIComponent(source)}`, { cache: "no-store" });
    }
    if (!response.ok) throw new Error(`${labels.failed} (HTTP ${response.status})`);
    const blob = await response.blob();
    if (!blob.size || /^(text\/|application\/(json|problem\+json|xml))/i.test(blob.type)) {
      throw new Error(labels.failed);
    }
    const extension = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/quicktime": "mov",
    }[blob.type.split(";")[0] ?? ""];
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = extension ? name.replace(/\.[^.]+$/, `.${extension}`) : name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Let the browser start consuming the object URL before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    toast.error(error instanceof Error && error.message ? error.message : labels.failed, {
      action: {
        label: labels.openOriginal,
        onClick: () => {
          window.open(source, "_blank", "noopener,noreferrer");
        },
      },
    });
  }
}
