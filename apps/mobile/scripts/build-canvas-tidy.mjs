// Offline ELK worker and geometry bridge; no remote script or layout service.
import { build } from "esbuild";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
output(
  join(root, "apps/mobile/src/features/agent/canvas-data/tidy-worker.json"),
  JSON.stringify(readFileSync(join(root, "node_modules/elkjs/lib/elk-worker.min.js"), "utf8")) +
    "\n"
);
const result = await build({
  absWorkingDir: root,
  entryPoints: ["apps/mobile/canvas-editor/tidy/runtime.ts"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  metafile: true,
  legalComments: "inline",
  plugins: [
    {
      name: "offline-tidy-worker",
      setup(builder) {
        // The browser artifact uses our offline worker; omit the Node fallback.
        builder.onResolve({ filter: /^elkjs\/lib\/elk\.bundled\.js$/ }, () => ({
          path: join(root, "node_modules/elkjs/lib/elk-api.js"),
        }));
      },
    },
  ],
});
const text = result.outputFiles[0].text;
output(
  join(root, "apps/mobile/src/features/agent/canvas-data/tidy-bundle.json"),
  JSON.stringify(text) + "\n"
);
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (match) packages.add(match[1]);
}
const notices = [];
for (const name of [...packages].sort()) {
  const dir = join(root, "node_modules", name);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const license = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "license.md"].find((file) =>
    existsSync(join(dir, file))
  );
  if (!license) throw new Error(`Missing bundled license: ${name}`);
  notices.push(`${name} ${pkg.version}\n${readFileSync(join(dir, license), "utf8")}`);
}
output(
  join(root, "apps/mobile/src/features/agent/canvas-data/TIDY-LICENSES"),
  notices.join("\n\n---\n\n")
);
console.log(
  `Bundled Canvas tidy runtime: ${text.length} bytes, ${packages.size} package licenses.`
);

function output(path, value) {
  if (process.argv.includes("--check")) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== value)
      throw new Error(
        `Stale offline editor artifact: ${path}. Run node apps/mobile/scripts/build-canvas-runtime.mjs.`
      );
  } else writeFileSync(path, value);
}
