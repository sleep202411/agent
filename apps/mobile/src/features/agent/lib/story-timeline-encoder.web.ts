import { createBrowserTimelineEncoder } from "./story-timeline-export-browser";
import type { TimelineExportArtifact } from "./story-timeline-export-session";
export function createTimelineEncoder() {
  const encoder = createBrowserTimelineEncoder();
  return {
    ...encoder,
    async share(artifact: TimelineExportArtifact, filename: string, current: () => boolean) {
      if (!current()) return;
      const file = encoder.file(artifact, filename);
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      try {
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        // Keep the download URL alive while the browser starts consuming it.
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    },
  };
}
