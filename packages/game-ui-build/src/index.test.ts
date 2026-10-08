import { expect, it } from "vitest";
import {
  GameUISourceSchema,
  GameUIArtifactSchema,
  type GameUISource,
} from "@repo/shared/experience-runtime";
import { buildGameUI, gameUISourceHash } from "./index.js";

const source = (
  content = 'import "./menu.css"; export function mount({root}) { root.textContent = "Home"; }'
): GameUISource => ({
  apiVersion: 1,
  surface: "main-menu",
  entry: "src/menu.ts",
  files: [
    { path: "src/menu.ts", content },
    { path: "src/menu.css", content: "button { min-height:44px; }" },
  ],
});
it("bundles source and CSS without executing code and freezes a deterministic identity", async () => {
  const input = source(
    'import "./menu.css"; globalThis.__mustNeverRun = true; export function mount({root}) { root.textContent = "Home"; }'
  );
  const a = await buildGameUI(input);
  const b = await buildGameUI({ ...input, files: [...input.files].reverse() });
  expect(a).toEqual(b);
  expect(a.javascript).toContain("mount");
  expect(a.css).toContain("44px");
  expect(a.sourceHash).toBe(gameUISourceHash(input));
  expect("__mustNeverRun" in globalThis).toBe(false);
});
it("rejects missing exports, syntax errors, remote dependencies and host filesystem escapes", async () => {
  for (const content of [
    "export const home = true;",
    "export function mount( {",
    'import "node:fs"; export function mount() {}',
    'import "/etc/passwd"; export function mount() {}',
    'import "https://evil.invalid/game.js"; export function mount() {}',
    'import "../../outside.js"; export function mount() {}',
  ])
    await expect(buildGameUI(source(content))).rejects.toThrow();
  await expect(
    buildGameUI({
      ...source(),
      files: [
        { path: "src/menu.ts", content: 'import "./menu.css";export function mount(){}' },
        { path: "src/menu.css", content: 'body{background:url("https://evil.invalid/pixel")}' },
      ],
    })
  ).rejects.toThrow();
});
it("bounds the file graph, requires unique relative files, and changes identity when code changes", async () => {
  const original = source();
  for (const invalid of [
    { ...original, entry: "not-there.ts" },
    { ...original, files: [...original.files, original.files[0]] },
    { ...original, files: [{ path: "../escape.js", content: "" }] },
    { ...original, files: [{ path: "menu.js", content: "x".repeat(65537) }] },
  ])
    expect(GameUISourceSchema.safeParse(invalid).success).toBe(false);
  expect((await buildGameUI(source("export function mount() {}"))).artifactHash).not.toBe(
    (await buildGameUI(original)).artifactHash
  );
});
it("honors cancellation before allocating a build", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(buildGameUI(source(), controller.signal)).rejects.toThrow();
});
it("accepts only film menus and rejects removed runtime modes and state declarations", async () => {
  const menu = source("export function mount() {}");
  for (const invalid of [
    { ...menu, apiVersion: 2, surface: "game" },
    { ...menu, surface: "game" },
    { ...menu, state: { version: 1, fields: {} } },
  ]) {
    expect(GameUISourceSchema.safeParse(invalid).success).toBe(false);
    await expect(buildGameUI(invalid as GameUISource)).rejects.toThrow();
  }
  const artifact = await buildGameUI(menu);
  expect(artifact).toMatchObject({ apiVersion: 1, surface: "main-menu" });
  expect(artifact).not.toHaveProperty("state");
  expect(GameUIArtifactSchema.safeParse({ ...artifact, surface: "game" }).success).toBe(false);
  expect(GameUIArtifactSchema.safeParse({ ...artifact, state: { fields: {} } }).success).toBe(
    false
  );
});
