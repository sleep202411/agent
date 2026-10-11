import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFile, mkdir, copyFile, appendFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(`${app}/package.json`);
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const output = `${app}/dist/ui`;
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: [`${app}/ui/main.tsx`],
  outdir: output,
  entryNames: "app",
  chunkNames: "chunks/[name]-[hash]",
  splitting: true,
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  jsx: "automatic",
  loader: {
    ".module.css": "local-css",
    ".woff2": "dataurl",
    ".woff": "dataurl",
    ".ttf": "dataurl",
  },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "harness-client-packages",
      setup(builder) {
        builder.onLoad(
          { filter: /\/web\/messages\/(en-US|zh-CN|zh-HK)\.json$/ },
          async ({ path }) => {
            const catalogue = JSON.parse(await readFile(path, "utf8"));
            return {
              contents: JSON.stringify({
                agent: catalogue.agent,
                experiencePlayer: catalogue.experiencePlayer,
              }),
              loader: "json",
            };
          }
        );
        // Published Harness client bundles register a CJS factory with its Web
        // shell. Materialize the same factory at build time for this embedded
        // composition; no vendor source, component or runtime logic is forked.
        builder.onResolve({ filter: /^@deepseek-ai\/.*\/client$/ }, (args) => ({
          path: require.resolve(args.path),
          namespace: "harness-client",
        }));
        builder.onLoad({ filter: /.*/, namespace: "harness-client" }, async ({ path }) => {
          const source = await readFile(path, "utf8");
          const prefix = "window.__ModuleLoader__.load({";
          if (!source.startsWith(prefix) || !source.includes("factory: (require) => {"))
            throw new Error(`Unsupported Harness client bundle: ${path}`);
          const contents = source
            .replace(prefix, "const registration = {")
            .replace("factory: (require) => {", "factory: () => {")
            .replace(
              /\}\);\s*\/\/# sourceMappingURL=.*\s*$/,
              "};\nmodule.exports = registration.factory();"
            );
          return { contents, loader: "js", resolveDir: dirname(path) };
        });
      },
    },
  ],
});
const playerStyles = `${app}/ui/player.css`;
const styles = await postcss([tailwind()]).process(await readFile(playerStyles, "utf8"), {
  from: playerStyles,
});
await appendFile(`${output}/app.css`, styles.css);
await copyFile(`${app}/ui/index.html`, `${output}/index.html`);
await mkdir(`${output}/experience-runtime/themes`, { recursive: true });
await copyFile(
  `${app}/ui/assets/experience-runtime/themes/core.film-dark.v1.json`,
  `${output}/experience-runtime/themes/core.film-dark.v1.json`
);
