import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundleWorkflowCode } from "@temporalio/worker";

const workflowsPath = fileURLToPath(new URL("./workflows.js", import.meta.url));
const outputPath = fileURLToPath(new URL("./studio-agent-workflow-bundle.js", import.meta.url));

const bundle = await bundleWorkflowCode({ workflowsPath });
await writeFile(outputPath, bundle.code, "utf8");
