import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
const output = new URL("../src/features/agent/canvas-data/panorama-bundle.json", import.meta.url);
const result = await build({
  entryPoints: [new URL("../panorama-viewer/runtime.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
});
const text = JSON.stringify(result.outputFiles[0].text) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== text) throw Error("Stale panorama runtime");
} else writeFileSync(output, text);
console.log(`Panorama runtime: ${text.length} bytes`);
