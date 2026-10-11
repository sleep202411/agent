// Bundle the same provider SDK installed for Studio; preserve dependency notices.
import { build } from "esbuild";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const result = await build({
  absWorkingDir: root,
  entryPoints: ["apps/mobile/world-player/runtime.ts"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  metafile: true,
  legalComments: "inline",
});
const text = result.outputFiles[0].text;
output(
  join(root, "apps/mobile/src/features/experience-player/world/data/runtime-bundle.json"),
  JSON.stringify(text) + "\n"
);
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.match(/^(.*\/)?node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (match) packages.add(resolve(root, `${match[1] ?? ""}node_modules/${match[2]}`));
}
const notices = [];
for (const dir of [...packages].sort()) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const name = pkg.name;
  const license = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "license.md"].find((file) =>
    existsSync(join(dir, file))
  );
  if (!license && name !== "aliyun-rtc-sdk") throw new Error(`Missing bundled license: ${name}`);
  const notice = license
    ? readFileSync(join(dir, license), "utf8")
    : "This installed package ships no standalone LICENSE file. Its inline notices are preserved in the runtime bundle.\n" +
      readFileSync(join(dir, "README.md"), "utf8");
  notices.push(`${name} ${pkg.version}\n${notice}`);
}
output(
  join(root, "apps/mobile/src/features/experience-player/world/data/RUNTIME-LICENSES"),
  notices.join("\n\n---\n\n")
);
console.log(`Bundled world runtime: ${text.length} bytes, ${packages.size} package licenses.`);

function output(path, value) {
  if (process.argv.includes("--check")) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== value)
      throw new Error(
        `Stale world runtime artifact: ${path}. Run npm run build:world-player --workspace=mobile.`
      );
  } else writeFileSync(path, value);
}
