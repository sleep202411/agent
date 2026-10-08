import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { afterEach, expect, it } from "vitest";
import {
  AppearanceDesignResultSchema,
  AppearancePresentationSchema,
} from "@repo/game-agent-protocol";
import { apply } from "./appearance-harness-plugin.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});
const presentation = {
  theme: {
    version: 1 as const,
    name: "Centered choices",
    css: '[data-experience-ui-region="choices"]{align-items:center}[data-experience-ui-region="choices"] [data-ui-part="list"]{flex-direction:column}',
    assets: [],
  },
};
async function fixture(nestedOutput = false, initialPresentation?: unknown, gameUI = true) {
  const root = await mkdtemp(join(tmpdir(), "appearance-test-"));
  directories.push(root);
  const requestId = randomUUID();
  const contextPath = join(root, "context.json");
  const resultPath = nestedOutput ? join(root, "output", "result.json") : join(root, "result.json");
  await writeFile(
    contextPath,
    JSON.stringify({
      requestId,
      prompt: "Center the choices",
      locale: "en-US",
      appearance: {
        version: 1,
        presentation: initialPresentation,
      },
      context: { title: "A story", choiceLabels: ["Continue"] },
      history: [],
    })
  );
  const registry = new Map<string, ToolDefinition>();
  let guard!: (input: { name: string }) => unknown;
  const ctx = {
    tools: {
      register: (tool: ToolDefinition) => registry.set(tool.name, tool),
      guard: (value: typeof guard) => {
        guard = value;
      },
    },
  } as unknown as Context;
  await apply(ctx, { contextPath, resultPath, gameUI });
  const execute = (name: string, args: unknown, signal = new AbortController().signal) =>
    registry.get(name)!.execute(args as never, { signal } as never);
  const reopen = async () => {
    registry.clear();
    await apply(ctx, { contextPath, resultPath, gameUI });
  };
  return { execute, resultPath, contextPath, requestId, guard, registry, root, reopen };
}

it.each([false, true])("only submits a checked presentation once (gameUI=%s)", async (gameUI) => {
  const f = await fixture(false, undefined, gameUI);
  expect([...f.registry.keys()]).toEqual([
    "read_appearance",
    "check_appearance",
    "submit_appearance",
    ...(gameUI
      ? [
          "read_game_ui",
          "read_game_ui_file",
          "write_game_ui_file",
          "delete_game_ui_file",
          "check_game_ui",
          "submit_game_ui",
          "restore_game_ui",
        ]
      : []),
  ]);
  expect(f.guard({ name: "bash" })).toBeTypeOf("string");
  expect(f.guard({ name: "read_appearance" })).toBeUndefined();
  const proposal = { presentation, message: "Centered the choices." };
  await expect(f.execute("submit_appearance", proposal)).rejects.toThrow("read_appearance");
  const view = JSON.parse(String(await f.execute("read_appearance", {})));
  expect(Boolean(view.gameUIContract)).toBe(gameUI);
  for (const tool of ["read_game_ui", "write_game_ui_file", "restore_game_ui"])
    expect(f.guard({ name: tool })).toBe(
      gameUI ? undefined : "This capability is unavailable for appearance design."
    );
  await expect(f.execute("submit_appearance", proposal)).rejects.toThrow("Check");
  await f.execute("check_appearance", proposal);
  await expect(
    f.execute("submit_appearance", {
      ...proposal,
      presentation: { ...presentation, theme: { ...presentation.theme, name: "Different" } },
    })
  ).rejects.toThrow("Check");
  await f.execute("submit_appearance", proposal);
  const result = AppearanceDesignResultSchema.parse(
    JSON.parse(await readFile(f.resultPath, "utf8"))
  );
  expect(result.requestId).toBe(f.requestId);
  expect(result.appearance.presentation).toEqual(presentation);
  await expect(f.execute("submit_appearance", proposal)).rejects.toThrow("Already submitted");
});

const codeSource = {
  apiVersion: 1,
  surface: "main-menu",
  entry: "menu.js",
  files: [
    {
      path: "menu.js",
      content:
        'export function mount({root,game,context}) { const button=document.createElement("button");button.textContent=context.copy.start;button.onclick=()=>game.invoke("start");root.append(button); }',
    },
  ],
};
async function stageCode(f: Awaited<ReturnType<typeof fixture>>) {
  await f.execute("read_game_ui", {});
  for (const file of codeSource.files) await f.execute("write_game_ui_file", file);
}
it("allows only one concurrent submission across native appearance and menu source", async () => {
  const f = await fixture();
  await f.execute("read_appearance", {});
  await f.execute("check_appearance", { presentation, message: "Updated." });
  await stageCode(f);
  await f.execute("check_game_ui", { entry: "menu.js" });
  const results = await Promise.allSettled([
    f.execute("submit_appearance", { presentation, message: "Updated." }),
    f.execute("submit_game_ui", { message: "Created menu." }),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason.message).toContain("Already submitted");
  const result = AppearanceDesignResultSchema.parse(
    JSON.parse(await readFile(f.resultPath, "utf8"))
  );
  expect(result.requestId).toBe(f.requestId);
  expect(result.gameUi ? result.gameUi.source : result.appearance.presentation).toEqual(
    result.gameUi ? codeSource : presentation
  );
});
it.each(["submit_appearance", "submit_game_ui"])(
  "preserves the submitted result across tool-host restart before %s",
  async (tool) => {
    const f = await fixture();
    const proposal = { presentation, message: "Original preview." };
    await f.execute("read_appearance", {});
    await f.execute("check_appearance", proposal);
    await f.execute("submit_appearance", proposal);
    const saved = await readFile(f.resultPath, "utf8");
    await f.reopen();
    if (tool === "submit_appearance") {
      await f.execute("read_appearance", {});
      await f.execute("check_appearance", proposal);
    } else {
      await stageCode(f);
      await f.execute("check_game_ui", { entry: "menu.js" });
    }
    await expect(
      f.execute(tool, tool === "submit_appearance" ? proposal : { message: "Changed menu." })
    ).rejects.toThrow("Already submitted");
    expect(await readFile(f.resultPath, "utf8")).toBe(saved);

    const next = JSON.parse(await readFile(f.contextPath, "utf8"));
    next.requestId = randomUUID();
    await writeFile(f.contextPath, JSON.stringify(next));
    await f.execute("read_appearance", {});
    await f.execute("check_appearance", proposal);
    await f.execute("submit_appearance", proposal);
    expect(JSON.parse(await readFile(f.resultPath, "utf8")).requestId).toBe(next.requestId);
  }
);
it("restores unfinished game source after tool-host restart, requires a fresh check and fences changed contexts", async () => {
  const f = await fixture();
  await stageCode(f);
  await Promise.all([
    f.execute("write_game_ui_file", { path: "menu.js", content: "export function mount( {" }),
    f.execute("write_game_ui_file", { path: "game.css", content: "button {min-height:44px}" }),
  ]);
  await expect(f.execute("check_game_ui", { entry: "menu.js" })).rejects.toThrow();
  await f.reopen();
  const restored = JSON.parse(String(await f.execute("read_game_ui", {})));
  expect(restored).toMatchObject({ surface: "main-menu", recoveredCandidate: true });
  expect(restored.files.map((file: { path: string }) => file.path)).toEqual([
    "menu.js",
    "game.css",
  ]);
  expect(
    JSON.parse(String(await f.execute("read_game_ui_file", { path: "menu.js" }))).content
  ).toBe("export function mount( {");
  await expect(f.execute("submit_game_ui", { message: "Recovered" })).rejects.toThrow("Check");
  await f.execute("write_game_ui_file", codeSource.files[0]);
  await f.execute("check_game_ui", { entry: "menu.js" });
  await f.execute("submit_game_ui", { message: "Recovered" });
  const next = JSON.parse(await readFile(f.contextPath, "utf8"));
  next.requestId = randomUUID();
  await writeFile(f.contextPath, JSON.stringify(next));
  const changed = JSON.parse(String(await f.execute("read_game_ui", {})));
  expect(changed).toMatchObject({ surface: "main-menu", files: [], recoveredCandidate: false });
});
it("builds and applies staged files while preserving the existing appearance", async () => {
  const f = await fixture(false, presentation);
  const view = JSON.parse(String(await f.execute("read_game_ui", {})));
  expect(view.contract.game.snapshotExample.actions.start).toBe(true);
  expect(view.files).toEqual([]);
  const proposal = { message: "Created the game menu." };
  await f.execute("write_game_ui_file", codeSource.files[0]);
  await expect(f.execute("submit_game_ui", proposal)).rejects.toThrow("Check");
  await f.execute("check_game_ui", { entry: "menu.js" });
  await f.execute("submit_game_ui", proposal);
  const result = AppearanceDesignResultSchema.parse(
    JSON.parse(await readFile(f.resultPath, "utf8"))
  );
  expect(result.appearance.presentation).toEqual(presentation);
  expect(result.gameUi?.source).toEqual(codeSource);
  expect(result.gameUi?.artifact.javascript).toContain("mount");
  await expect(f.execute("submit_game_ui", proposal)).rejects.toThrow("Already submitted");
});
it("retains failed candidate files and repairs through the same file tools", async () => {
  const f = await fixture();
  await f.execute("read_game_ui", {});
  const broken = { path: "menu.js", content: "export function mount( {" };
  await f.execute("write_game_ui_file", broken);
  await expect(f.execute("check_game_ui", { entry: "menu.js" })).rejects.toThrow();
  expect(JSON.parse(await readFile(`${f.resultPath}.candidate.json`, "utf8")).source.files).toEqual(
    [broken]
  );
  await expect(readFile(f.resultPath)).rejects.toThrow();
  await f.execute("write_game_ui_file", codeSource.files[0]);
  await f.execute("check_game_ui", { entry: "menu.js" });
  await f.execute("submit_game_ui", { message: "Repaired" });
  expect(JSON.parse(await readFile(f.resultPath, "utf8")).gameUi.source).toEqual(codeSource);
});
it("rejects post-check edits, escaped paths, stale context and cancelled submits", async () => {
  const f = await fixture();
  await stageCode(f);
  await f.execute("check_game_ui", { entry: "menu.js" });
  await expect(
    f.execute("write_game_ui_file", { path: "../escape.js", content: "" })
  ).rejects.toThrow();
  await f.execute("write_game_ui_file", { path: "menu.js", content: "export function mount(){}" });
  await expect(f.execute("submit_game_ui", { message: "Edited" })).rejects.toThrow("Check");
  await f.execute("check_game_ui", { entry: "menu.js" });
  const controller = new AbortController();
  controller.abort();
  await expect(
    f.execute("submit_game_ui", { message: "Changed" }, controller.signal)
  ).rejects.toThrow();
  const request = JSON.parse(await readFile(f.contextPath, "utf8"));
  request.requestId = randomUUID();
  await writeFile(f.contextPath, JSON.stringify(request));
  await expect(f.execute("submit_game_ui", { message: "Changed" })).rejects.toThrow(
    "Preview changed"
  );
  await expect(readFile(f.resultPath)).rejects.toThrow();
});
it("reads and deletes virtual files without touching host paths", async () => {
  const f = await fixture();
  await stageCode(f);
  expect(JSON.parse(String(await f.execute("read_game_ui_file", { path: "menu.js" })))).toEqual(
    codeSource.files[0]
  );
  await f.execute("delete_game_ui_file", { path: "menu.js" });
  await expect(f.execute("read_game_ui_file", { path: "menu.js" })).rejects.toThrow("not found");
  await expect(f.execute("check_game_ui", { entry: "menu.js" })).rejects.toThrow();
});

it.each([false, true])("can retry an interrupted output write (gameUI=%s)", async (gameUI) => {
  const f = await fixture(true, undefined, gameUI);
  const proposal = { presentation, message: "Updated." };
  await f.execute("read_appearance", {});
  await f.execute("check_appearance", proposal);
  await expect(f.execute("submit_appearance", proposal)).rejects.toThrow();
  await expect(readFile(f.resultPath)).rejects.toThrow();
  await mkdir(join(f.root, "output"));
  await f.execute("submit_appearance", proposal);
  expect(JSON.parse(await readFile(f.resultPath, "utf8")).requestId).toBe(f.requestId);
});

it("rejects injected code, resource URLs, invalid colors and unbounded dimensions", () => {
  for (const background of ["url(https://evil.invalid/image)", "#12345", "red;display:none"]) {
    expect(
      AppearancePresentationSchema.safeParse({
        ...presentation,
        theme: {
          ...presentation.theme,
          css: `[data-experience-ui-region="choices"] [data-ui-part="option"]{background:${background}}`,
        },
      }).success
    ).toBe(false);
  }
  expect(
    AppearancePresentationSchema.safeParse({ ...presentation, html: "<script/>" }).success
  ).toBe(false);
  expect(
    AppearancePresentationSchema.safeParse({
      ...presentation,
      theme: {
        ...presentation.theme,
        css: '[data-experience-ui-region="choices"] [data-ui-part="option"]{font-size:400px}',
      },
    }).success
  ).toBe(false);
});

it("does not produce a result after cancellation", async () => {
  const f = await fixture();
  await f.execute("read_appearance", {});
  const proposal = { presentation, message: "Centered." };
  await f.execute("check_appearance", proposal);
  const controller = new AbortController();
  controller.abort();
  await expect(f.execute("submit_appearance", proposal, controller.signal)).rejects.toThrow();
  await expect(readFile(f.resultPath)).rejects.toThrow();
});

it.each([false, true])(
  "rejects stale results and reads the new context (gameUI=%s)",
  async (gameUI) => {
    const f = await fixture(false, undefined, gameUI);
    const proposal = { presentation, message: "Updated." };
    await f.execute("read_appearance", {});
    await f.execute("check_appearance", proposal);
    const request = JSON.parse(await readFile(f.contextPath, "utf8"));
    request.requestId = randomUUID();
    await writeFile(f.contextPath, JSON.stringify(request));
    await expect(f.execute("submit_appearance", proposal)).rejects.toThrow("Preview changed");
    await expect(readFile(f.resultPath)).rejects.toThrow();
    await f.execute("read_appearance", {});
    await f.execute("check_appearance", proposal);
    await f.execute("submit_appearance", proposal);
    expect(JSON.parse(await readFile(f.resultPath, "utf8")).requestId).toBe(request.requestId);
  }
);

it("exposes the versioned UI contract and preserves copy while replacing the complete theme", async () => {
  const f = await fixture(false, { ...presentation, copy: { start: { "en-US": "Enter" } } });
  const view = JSON.parse(String(await f.execute("read_appearance", {})));
  expect(view.uiContract.apiVersion).toBe(1);
  expect(Object.keys(view.uiContract.regions)).toEqual(["start", "playback", "choices", "pause"]);
  const theme = {
    ...presentation.theme,
    css:
      presentation.theme.css +
      '[data-experience-ui-region="pause"] [data-ui-part="panel"]{color:#eee}',
  };
  const proposal = { presentation: { theme }, message: "Updated menus." };
  await f.execute("check_appearance", proposal);
  await f.execute("submit_appearance", proposal);
  const result = AppearanceDesignResultSchema.parse(
    JSON.parse(await readFile(f.resultPath, "utf8"))
  );
  expect(result.appearance.presentation).toEqual({ theme, copy: { start: { "en-US": "Enter" } } });
});

it("rejects retired parallel style sources and executable properties", () => {
  for (const retired of [
    { start: {} },
    { choices: {} },
    { transport: {} },
    { pause: {} },
    { html: "<script/>" },
  ])
    expect(AppearancePresentationSchema.safeParse({ ...presentation, ...retired }).success).toBe(
      false
    );
});

it("checks and submits a complete CSS/SVG theme while preserving untouched surfaces", async () => {
  const f = await fixture();
  const request = JSON.parse(await readFile(f.contextPath, "utf8"));
  request.appearance.presentation = presentation;
  await writeFile(f.contextPath, JSON.stringify(request));
  const read = JSON.parse(String(await f.execute("read_appearance", {})));
  expect(read.themeContract.version).toBe(1);
  const theme = {
    version: 1,
    name: "Palace",
    css: '[data-experience-ui-region="start"] [data-ui-part="panel"] {background-image:asset("frame");color:#d6b77a}',
    assets: [
      {
        id: "frame",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><path d="M1 1L99 1" stroke="#d6b77a"/></svg>',
      },
    ],
  };
  const proposal = { presentation: { theme }, message: "Applied palace theme." };
  await expect(
    f.execute("check_appearance", {
      ...proposal,
      presentation: { theme: { ...theme, css: "body{display:none}" } },
    })
  ).rejects.toThrow();
  await f.execute("check_appearance", proposal);
  await expect(
    f.execute("submit_appearance", {
      ...proposal,
      presentation: { theme: { ...theme, name: "Different" } },
    })
  ).rejects.toThrow("Check");
  await f.execute("submit_appearance", proposal);
  const result = AppearanceDesignResultSchema.parse(
    JSON.parse(await readFile(f.resultPath, "utf8"))
  );
  expect(result.appearance.presentation).toEqual({ ...presentation, theme });
});

it("submits copy-only changes without replacing the theme or other locales", async () => {
  const current = {
    ...presentation,
    copy: { start: { "en-US": "Enter story", "zh-CN": "Begin" } },
    theme: {
      version: 1,
      name: "Palace",
      css: '[data-experience-ui-region="start"] [data-ui-part="primary"]{color:#d6b77a}',
      assets: [],
    },
  };
  const f = await fixture(false, current);
  const read = JSON.parse(String(await f.execute("read_appearance", {})));
  expect(read.uiContract.copy.start.maximumCharacters).toBe(80);
  const proposal = {
    presentation: { copy: { start: { "zh-CN": null } } },
    message: "Restored the default start label.",
  };
  await f.execute("check_appearance", proposal);
  await f.execute("submit_appearance", proposal);
  const result = AppearanceDesignResultSchema.parse(
    JSON.parse(await readFile(f.resultPath, "utf8"))
  );
  expect(result.appearance.presentation).toEqual({
    ...current,
    copy: { start: { "en-US": "Enter story", "zh-CN": null } },
  });
});
