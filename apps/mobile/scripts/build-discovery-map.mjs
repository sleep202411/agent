import { build } from "esbuild";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const result = await build({
  absWorkingDir: root,
  entryPoints: ["apps/mobile/discovery-map/entry.ts"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  metafile: true,
  legalComments: "inline",
});
function output(name, value) {
  const path = join(root, "apps/mobile/public/discovery-map", name);
  if (process.argv.includes("--check")) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== value)
      throw new Error(
        `Stale map artifact: ${name}. Run npm run build:discovery-map --workspace=mobile.`
      );
  } else writeFileSync(path, value);
}
output("runtime.js", result.outputFiles[0].text);
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.match(/^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//);
  if (match) packages.set(match[1], match[2]);
}
const notices = [];
for (const [relative, name] of [...packages].sort()) {
  const dir = join(root, relative);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const license = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "license.md"].find((file) =>
    existsSync(join(dir, file))
  );
  if (!license) throw new Error(`Missing bundled license: ${name}`);
  notices.push(`${name} ${pkg.version}\n${readFileSync(join(dir, license), "utf8")}`);
}
output("LICENSES.txt", notices.join("\n\n---\n\n"));
console.log(`Built hosted map runtime: ${result.outputFiles[0].text.length} bytes.`);
