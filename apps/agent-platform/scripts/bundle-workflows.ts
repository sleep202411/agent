import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { bundleWorkflowCode } from "@temporalio/worker";

const outputDirectory = resolve(process.cwd(), ".temporal");
const outputPath = resolve(outputDirectory, "workflow-bundle.js");
const workflowsPath = resolve(process.cwd(), "src/runtime/workflows.ts");

const bundle = await bundleWorkflowCode({ workflowsPath });
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, bundle.code, { encoding: "utf8", mode: 0o640 });

process.stdout.write(`Temporal workflow bundle written to ${outputPath}\n`);
