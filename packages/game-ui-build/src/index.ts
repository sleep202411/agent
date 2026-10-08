import { createHash } from "node:crypto";
import { posix } from "node:path";
import { context, version, type Loader } from "esbuild";
import {
  GameUISourceSchema,
  GameUIArtifactSchema,
  type GameUISource,
  type GameUIArtifact,
} from "@repo/shared/experience-runtime";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function gameUISourceHash(input: GameUISource): string {
  const source = GameUISourceSchema.parse(input);
  return hash(
    JSON.stringify({
      ...source,
      files: [...source.files].sort((a, b) => a.path.localeCompare(b.path, "en")),
    })
  );
}

/** In-memory compiler: never loads user plugins, package manifests, build scripts or host files. */
export async function buildGameUI(
  input: GameUISource,
  signal?: AbortSignal
): Promise<GameUIArtifact> {
  const source = GameUISourceSchema.parse(input);
  signal?.throwIfAborted();
  const files = new Map(source.files.map((file) => [file.path, file.content]));
  const build = await context({
    entryPoints: ["__fizz_boot__"],
    bundle: true,
    write: false,
    outdir: "/fizz-output",
    platform: "browser",
    format: "iife",
    globalName: "FizzGameUI",
    target: "es2022",
    charset: "utf8",
    logLevel: "silent",
    metafile: true,
    sourcemap: false,
    legalComments: "none",
    tsconfigRaw: { compilerOptions: { useDefineForClassFields: true } },
    plugins: [
      {
        name: "fizz-source-only",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === "entry-point") return { path: "__fizz_boot__", namespace: "fizz" };
            if (args.importer === "__fizz_boot__" && args.path === source.entry)
              return { path: source.entry, namespace: "fizz" };
            if (!args.path.startsWith("./") && !args.path.startsWith("../"))
              return {
                errors: [{ text: `Only relative source imports are permitted: ${args.path}` }],
              };
            const path = posix.normalize(posix.join(posix.dirname(args.importer), args.path));
            if (path.startsWith("../") || !files.has(path))
              return { errors: [{ text: `Source file not found: ${args.path}` }] };
            return { path, namespace: "fizz" };
          });
          builder.onLoad({ filter: /.*/, namespace: "fizz" }, (args) => {
            if (args.path === "__fizz_boot__")
              return {
                contents: `export { mount } from ${JSON.stringify(source.entry)};`,
                loader: "js",
              };
            const loaders: Record<string, Loader> = {
              js: "js",
              ts: "ts",
              css: "css",
              json: "json",
              svg: "dataurl",
            };
            return {
              contents: files.get(args.path)!,
              loader: loaders[posix.extname(args.path).slice(1)],
            };
          });
        },
      },
    ],
  });
  const cancelled = () => {
    void build.cancel();
  };
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    cancelled();
  }, 10_000);
  signal?.addEventListener("abort", cancelled, { once: true });
  try {
    signal?.throwIfAborted();
    const result = await build.rebuild();
    if (timedOut) throw new Error("Game UI build timed out.");
    signal?.throwIfAborted();
    if (Object.values(result.metafile.outputs).some((output) => output.imports.length > 0))
      throw new Error("All game UI dependencies must be bundled source files.");
    const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
    const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
    const sourceHash = gameUISourceHash(source);
    const toolchain = `esbuild@${version}/fizz-game-ui@1`;
    return GameUIArtifactSchema.parse({
      apiVersion: source.apiVersion,
      surface: source.surface,
      sourceHash,
      artifactHash: hash(JSON.stringify({ sourceHash, toolchain, javascript, css })),
      toolchain,
      javascript,
      css,
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancelled);
    await build.dispose();
  }
}
