import ELK from "elkjs/lib/elk-api.js";

/**
 * Creates ELK's browser client around one native worker. The worker contains
 * the heavy Java layout implementation; graph orchestration remains a small,
 * non-blocking layer in the application bundle.
 */
export function createBrowserElkLayoutEngine() {
  if (typeof Worker === "undefined") {
    throw new Error("Canvas layout requires Web Worker support");
  }
  return new ELK({
    workerFactory: () => new Worker(new URL("./elk-layout.worker.ts", import.meta.url)),
  });
}
