import ELK from "elkjs/lib/elk-api.js";
import source from "../../src/features/agent/canvas-data/tidy-worker.json";
/** ELK runs in an offline worker, never on the native UI or browser frame thread. */
export function createBrowserTidyEngine() {
  if (typeof Worker === "undefined") throw Error("Canvas layout requires Web Worker support.");
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    const engine = new ELK({ workerFactory: () => new Worker(url) });
    const terminate = engine.terminateWorker.bind(engine);
    engine.terminateWorker = () => {
      terminate();
      URL.revokeObjectURL(url);
    };
    return engine;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
