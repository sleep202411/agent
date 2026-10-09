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
async function fixture(nestedOutput = false, initialPresentation?: unknown) {
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
  await apply(ctx, { contextPath, resultPath });
  const execute = (name: string, args: unknown, signal = new AbortController().signal) =>
    registry.get(name)!.execute(args as never, { signal } as never);
  const reopen = async () => {
    registry.clear();
    await apply(ctx, { contextPath, resultPath });
  };
  return { execute, resultPath, contextPath, requestId, guard, registry, root, reopen };
}

it("only exposes appearance tools and submits an exact checked presentation once", async () => {
  const f = await fixture();
  expect([...f.registry.keys()]).toEqual([
    "read_appearance",
    "check_appearance",
    "submit_appearance",
  ]);
  expect(f.guard({ name: "bash" })).toBeTypeOf("string");
  expect(f.guard({ name: "read_appearance" })).toBeUndefined();
  const proposal = { presentation, message: "Centered the choices." };
  await expect(f.execute("submit_appearance", proposal)).rejects.toThrow("read_appearance");
  await f.execute("read_appearance", {});
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
  expect(result.appearance.presentation).toEqual(presentation);
  await expect(f.execute("submit_appearance", proposal)).rejects.toThrow("Already submitted");
});

it("fences concurrent submissions and preserves submitted results across tool-host restart", async () => {
  const f = await fixture();
  const proposal = { presentation, message: "Updated." };
  await f.execute("read_appearance", {});
  await f.execute("check_appearance", proposal);
  const results = await Promise.allSettled([
    f.execute("submit_appearance", proposal),
    f.execute("submit_appearance", proposal),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const saved = await readFile(f.resultPath, "utf8");
  await f.reopen();
  await f.execute("read_appearance", {});
  await f.execute("check_appearance", proposal);
  await expect(f.execute("submit_appearance", proposal)).rejects.toThrow("Already submitted");
  expect(await readFile(f.resultPath, "utf8")).toBe(saved);
});

it("can retry an interrupted output write", async () => {
  const f = await fixture(true, undefined);
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

it("rejects stale results and reads the new context", async () => {
  const f = await fixture(false, undefined);
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
});

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
