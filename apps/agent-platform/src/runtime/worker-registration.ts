import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as activities from "./activities.js";
import * as longDocumentActivities from "./long-document-activities.js";

/**
 * The lane-to-Activity map is a production contract. Keeping it outside the
 * Worker bootstrap makes registration testable without opening a Temporal
 * connection or loading credentials.
 */
export const agentActivityRegistrations = Object.freeze({
  control: Object.freeze({
    openRunActivity: activities.openRunActivity,
  }),
  inference: Object.freeze({
    runInferenceActivity: activities.runInferenceActivity,
  }),
  tool: Object.freeze({
    executeToolActivity: activities.executeToolActivity,
  }),
  lifecycle: Object.freeze({
    reportInvocationLifecycleActivity: activities.reportInvocationLifecycleActivity,
  }),
  cleanup: Object.freeze({
    endRunActivity: activities.endRunActivity,
  }),
  document: Object.freeze({
    claimLongDocumentAnalysisActivity: longDocumentActivities.claimLongDocumentAnalysisActivity,
    mapLongDocumentSectionActivity: longDocumentActivities.mapLongDocumentSectionActivity,
    reduceLongDocumentAnalysisActivity: longDocumentActivities.reduceLongDocumentAnalysisActivity,
    finalizeLongDocumentAnalysisActivity:
      longDocumentActivities.finalizeLongDocumentAnalysisActivity,
    completeLongDocumentAnalysisActivity:
      longDocumentActivities.completeLongDocumentAnalysisActivity,
    failLongDocumentAnalysisActivity: longDocumentActivities.failLongDocumentAnalysisActivity,
  }),
});

export function temporalWorkflowRegistration(input: {
  nodeEnv: string;
  cwd?: string;
  fileExists?: (path: string) => boolean;
}):
  | { workflowBundle: { codePath: string } }
  | {
      workflowsPath: string;
    } {
  const fileExists = input.fileExists ?? existsSync;
  if (input.nodeEnv === "production") {
    const codePath = resolve(input.cwd ?? process.cwd(), ".temporal/workflow-bundle.js");
    if (!fileExists(codePath)) {
      throw new Error(`Prebuilt Temporal workflow bundle is missing at ${codePath}`);
    }
    return { workflowBundle: { codePath } };
  }

  const typescriptPath = fileURLToPath(new URL("./workflows.ts", import.meta.url));
  const javascriptPath = fileURLToPath(new URL("./workflows.js", import.meta.url));
  return {
    workflowsPath: fileExists(typescriptPath) ? typescriptPath : javascriptPath,
  };
}
