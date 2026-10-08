import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyStoryPlotImport,
  MAX_PLOT_IMPORT_BYTES,
  parseStoryPlotImport,
  storyPlotImportAssetWrites,
  storyPlotImportClipWrites,
} from "./story-plot-import";
import { buildStoryCanvasModel } from "../app/[locale]/story-studio/_components/project-canvas/story-project-canvas-model";
import { StoryCanvasHistory } from "../app/[locale]/story-studio/_components/project-canvas/story-canvas-history";
import {
  InteractiveStoryDraftContentSchema,
  createLockableInteractiveStoryDraftContentSchema,
} from "../../server/src/story-studio/interactive-film.schema";
import type { InteractiveStoryDraftContent } from "./story-projects-api";

const empty = (): InteractiveStoryDraftContent => ({
  storyBible: {
    logline: "Existing logline",
    synopsis: "",
    characters: [],
    stateVariables: [],
    endings: [],
  },
  graph: { entryNodeId: null, nodes: [] },
  productionNotes: ["Keep this"],
});
const example = () => ({
  entryNodeId: "opening",
  assets: [
    {
      id: "hero",
      kind: "character",
      name: "Mira",
      description: "A courier.",
      imagePrompt: "Cinematic portrait of Mira at dawn.",
      videoPrompt: "Mira stands still in a cold breeze.",
      negativePrompt: "cartoon",
    },
  ],
  nodes: [
    {
      id: "opening",
      type: "scene",
      title: "Opening",
      description: "  第一行\n“保留原文” 🎬  ",
      next: "choice",
      storyboard: {
        clips: [
          {
            id: "letter",
            kind: "image",
            title: "Letter",
            durationMs: 2000,
            prompt: "A sealed letter on worn floorboards.",
          },
          {
            id: "turn",
            kind: "video",
            title: "Turn",
            durationMs: 4000,
            prompt: "Mira looks down at the letter.",
          },
        ],
      },
    },
    {
      id: "choice",
      type: "decision",
      prompt: "走哪条路？",
      choices: [
        { label: "左", next: "ending" },
        { label: "右", next: "ending" },
      ],
    },
    { id: "ending", type: "scene", title: "End", next: null },
  ],
});
const parse = (value: unknown) => parseStoryPlotImport(JSON.stringify(value));

describe("plot JSON import", () => {
  it.each(["en-US", "zh-CN", "zh-HK"])(
    "ships a valid downloadable %s template matching the server contract",
    (locale) => {
      const md = readFileSync(
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          "../public/templates/story-plot",
          `${locale}.md`
        ),
        "utf8"
      );
      const examples = [...md.matchAll(/```json\n([\s\S]+?)\n```/g)];
      expect(examples).toHaveLength(2);
      for (const [, json] of examples) {
        const examplePlot = parseStoryPlotImport(json!);
        const applied = applyStoryPlotImport(empty(), examplePlot, locale);
        expect(
          createLockableInteractiveStoryDraftContentSchema(locale).safeParse(applied.content)
            .success
        ).toBe(true);
        expect(buildStoryCanvasModel(applied.content, locale).nodes).toHaveLength(
          examplePlot.nodes.length
        );
      }
      const plot = parseStoryPlotImport(examples[0]![1]!);
      const { content } = applyStoryPlotImport(empty(), plot, locale);
      expect(
        createLockableInteractiveStoryDraftContentSchema(locale).safeParse(content).success
      ).toBe(true);
      expect(buildStoryCanvasModel(content, locale).nodes).toHaveLength(4);
      expect(plot.assets).toHaveLength(2);
      expect(plot.stateVariables).toHaveLength(1);
      expect(storyPlotImportClipWrites(plot, "ns").at(0)?.clips).toHaveLength(2);
    }
  );

  it("imports typed variables, entry effects, conditional routes, choice effects and visibility without duplication", () => {
    const value = example();
    const stateful: Record<string, unknown> = {
      ...value,
      stateVariables: [
        {
          key: "courage",
          name: "勇气",
          valueType: "number",
          initialValue: 0,
          note: "面对危险时积累。",
        },
        {
          key: "met",
          name: "见过守门人",
          valueType: "boolean",
          initialValue: false,
        },
      ],
      nodes: value.nodes.map((node) =>
        node.id === "opening"
          ? {
              ...node,
              onEnterEffects: [{ kind: "set", key: "met", value: true }],
              routes: [
                {
                  when: {
                    kind: "compare",
                    variableKey: "courage",
                    operator: "at-least",
                    value: 3,
                  },
                  next: "ending",
                },
              ],
            }
          : node.type === "decision" && node.choices
            ? {
                ...node,
                choices: node.choices.map((choice, index) => ({
                  ...choice,
                  ...(index === 0
                    ? {
                        effects: [{ kind: "add", key: "courage", amount: 1 }],
                        visibleWhen: {
                          kind: "compare",
                          variableKey: "met",
                          operator: "equals",
                          value: true,
                        },
                      }
                    : {}),
                })),
              }
            : node
      ),
    };
    const plot = parse(stateful);
    const first = applyStoryPlotImport(empty(), plot, "zh-CN", "append", "one").content;
    const second = applyStoryPlotImport(first, plot, "zh-CN", "append", "two").content;

    expect(first.storyBible.stateVariables).toEqual([
      {
        key: "courage",
        name: { "zh-CN": "勇气" },
        valueType: "number",
        initialValue: 0,
        note: "面对危险时积累。",
      },
      {
        key: "met",
        name: { "zh-CN": "见过守门人" },
        valueType: "boolean",
        initialValue: false,
      },
    ]);
    expect(second.storyBible.stateVariables).toEqual(first.storyBible.stateVariables);
    expect(first.graph.nodes[0]).toMatchObject({
      onEnterEffects: [{ kind: "set", key: "met", value: true }],
      exit: {
        routes: [
          {
            when: {
              kind: "compare",
              variableKey: "courage",
              operator: "at-least",
              value: 3,
            },
            target: { kind: "node", nodeId: "import:one:ending" },
          },
          { target: { kind: "node", nodeId: "import:one:choice" } },
        ],
      },
    });
    expect(first.graph.nodes[1]).toMatchObject({
      exit: {
        choices: [
          {
            effects: [{ kind: "add", key: "courage", amount: 1 }],
            visibleWhen: {
              kind: "compare",
              variableKey: "met",
              operator: "equals",
              value: true,
            },
          },
          {},
        ],
      },
    });
    expect(InteractiveStoryDraftContentSchema.safeParse(second).success).toBe(true);
  });

  it("rejects conflicting or unknown state definitions at their source path", () => {
    const value = example();
    const plot = parse({
      ...value,
      stateVariables: [
        {
          key: "met",
          name: "Met",
          valueType: "boolean",
          initialValue: false,
        },
      ],
    });
    const current = empty();
    current.storyBible.stateVariables = [
      {
        key: "met",
        name: { "en-US": "Met" },
        valueType: "number",
        initialValue: 0,
      },
    ];
    expect(() => applyStoryPlotImport(current, plot, "en-US")).toThrow(
      "$.stateVariables[0].key: state"
    );

    const unknown = {
      ...value,
      nodes: value.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              onEnterEffects: [{ kind: "add", key: "missing", amount: 1 }],
            }
          : node
      ),
    };
    expect(() => applyStoryPlotImport(empty(), parse(unknown), "en-US")).toThrow(
      "$.nodes[0].onEnterEffects[0]: state"
    );
  });

  it("rejects imports that would exceed the chapter state-variable capacity", () => {
    const current = empty();
    current.storyBible.stateVariables = Array.from({ length: 64 }, (_, index) => ({
      key: `existing_${index}`,
      name: { "en-US": `Existing ${index}` },
      valueType: "number" as const,
      initialValue: 0,
    }));
    const plot = parse({
      ...example(),
      stateVariables: [
        {
          key: "overflow",
          name: "Overflow",
          valueType: "number",
          initialValue: 0,
        },
      ],
    });

    expect(() => applyStoryPlotImport(current, plot, "en-US")).toThrow("$.stateVariables: state");
  });

  it("preserves exact copy, ordered choices, rejoining branches, entry and terminal nodes through the server schema", () => {
    const result = applyStoryPlotImport(empty(), parse(example()), "zh-CN");
    const saved = InteractiveStoryDraftContentSchema.parse(result.content);
    expect(saved).toEqual(result.content);
    expect(saved.graph.entryNodeId).toBe(saved.graph.nodes[0]!.nodeId);
    expect(saved.graph.nodes[0]).toMatchObject({
      description: example().nodes[0]!.description,
      exit: { routes: [{ target: { kind: "node", nodeId: saved.graph.nodes[1]!.nodeId } }] },
    });
    expect(saved.graph.nodes[1]).toMatchObject({
      exit: {
        prompt: { "zh-CN": "走哪条路？" },
        choices: [
          {
            label: { "zh-CN": "左" },
            target: { kind: "node", nodeId: saved.graph.nodes[2]!.nodeId },
          },
          {
            label: { "zh-CN": "右" },
            target: { kind: "node", nodeId: saved.graph.nodes[2]!.nodeId },
          },
        ],
      },
    });
    expect(saved.graph.nodes[2]).toMatchObject({
      exit: { kind: "auto", routes: [{ target: null }] },
    });
    const model = buildStoryCanvasModel(result.content, "zh-CN");
    expect(model.nodes).toHaveLength(3);
    expect(model.edges).toHaveLength(3);
  });

  it("maps asset prompts and contiguous clip start times without bindings or @ mentions", () => {
    const plot = parse(example());
    const assets = storyPlotImportAssetWrites(plot, "abc123");
    const clips = storyPlotImportClipWrites(plot, "abc123");
    expect(assets).toEqual([
      {
        stableKey: "imp.abc123.hero",
        kind: "character",
        name: "Mira",
        description: "A courier.",
        imagePrompt: "Cinematic portrait of Mira at dawn.",
        videoPrompt: "Mira stands still in a cold breeze.",
        negativePrompt: "cartoon",
      },
    ]);
    expect(clips).toEqual([
      {
        sourceNodeId: "opening",
        plotNodeId: `import:abc123:opening`,
        durationMs: 6000,
        clips: [
          {
            stableKey: "letter",
            kind: "image",
            title: "Letter",
            startMs: 0,
            durationMs: 2000,
            imagePrompt: "A sealed letter on worn floorboards.",
            videoPrompt: null,
            negativePrompt: null,
          },
          {
            stableKey: "turn",
            kind: "video",
            title: "Turn",
            startMs: 2000,
            durationMs: 4000,
            imagePrompt: null,
            videoPrompt: "Mira looks down at the letter.",
            negativePrompt: null,
          },
        ],
      },
    ]);
  });

  it("repeated imports cannot overwrite content or bindings and undo removes the whole imported group", () => {
    const first = applyStoryPlotImport(empty(), parse(example()), "en-US").content;
    const snapshot = structuredClone(first);
    const second = applyStoryPlotImport(first, parse(example()), "en-US").content;
    expect(first).toEqual(snapshot);
    expect(second.storyBible).toEqual(first.storyBible);
    expect(second.productionNotes).toEqual(first.productionNotes);
    expect(second.graph.entryNodeId).toBe(first.graph.entryNodeId);
    expect(second.graph.nodes.slice(0, 3)).toEqual(first.graph.nodes);
    expect(new Set(second.graph.nodes.map((node) => node.nodeId)).size).toBe(6);
    expect(
      createLockableInteractiveStoryDraftContentSchema("en-US").safeParse(second).success
    ).toBe(true);
    const history = new StoryCanvasHistory();
    history.capture({ content: first, nodePositions: {} });
    expect(history.undo({ content: second, nodePositions: {} })?.content).toEqual(first);
    expect(history.redo({ content: first, nodePositions: {} })?.content).toEqual(second);
  });

  it("replaces only the supplied chapter graph with fresh identities and can undo the entire replacement", () => {
    const first = applyStoryPlotImport(empty(), parse(example()), "en-US").content;
    const original = structuredClone(first);
    const result = applyStoryPlotImport(first, parse(example()), "zh-CN", "replace");
    expect(result.content.graph.nodes).toEqual(result.importedNodes);
    expect(result.content.graph.nodes).toHaveLength(3);
    expect(result.content.graph.entryNodeId).toBe(result.entryNodeId);
    expect(
      result.content.graph.nodes.every(
        (node) => !first.graph.nodes.some((old) => old.nodeId === node.nodeId)
      )
    ).toBe(true);
    expect(result.content.storyBible).toEqual(first.storyBible);
    expect(result.content.productionNotes).toEqual(first.productionNotes);
    expect(first).toEqual(original);
    expect(InteractiveStoryDraftContentSchema.safeParse(result.content).success).toBe(true);
    const history = new StoryCanvasHistory();
    const before = {
      content: first,
      nodePositions: { [first.graph.nodes[0]!.nodeId]: { x: 42, y: 80 } },
    };
    const after = { content: result.content, nodePositions: {} };
    history.capture(before);
    expect(history.undo(after)).toEqual(before);
    expect(history.redo(before)).toEqual(after);
  });

  it.each([
    ["null", "$: object"],
    ["```json\n{}\n```", "$.entryNodeId: id"],
    [JSON.stringify({ ...example(), version: 1 }), "$.version: field"],
    [JSON.stringify({ ...example(), metadata: "must not vanish" }), "$.metadata: field"],
    [JSON.stringify({ ...example(), entryNodeId: "missing" }), "$.entryNodeId: target"],
    [JSON.stringify({ ...example(), nodes: [] }), "$.nodes: nodes"],
    [
      JSON.stringify({ entryNodeId: example().entryNodeId, nodes: example().nodes }),
      "$.assets: assets",
    ],
    [
      JSON.stringify({ ...example(), nodes: [{ id: "opening", type: "scene", title: "x" }] }),
      "$.nodes[0].next: id",
    ],
    [
      JSON.stringify({ ...example(), nodes: [...example().nodes, example().nodes[0]] }),
      "$.nodes[3].id: duplicate",
    ],
    [
      JSON.stringify({
        ...example(),
        nodes: [...example().nodes, { id: "orphan", type: "scene", title: "lost", next: null }],
      }),
      "$.nodes[3].id: unreachable",
    ],
    [
      JSON.stringify({ ...example(), nodes: [{ ...example().nodes[0], next: "missing" }] }),
      "$.nodes[0].next: target",
    ],
    [
      JSON.stringify({ ...example(), nodes: [{ ...example().nodes[0], type: "world" }] }),
      "$.nodes[0].type: type",
    ],
    [
      JSON.stringify({ ...example(), nodes: [{ ...example().nodes[0], title: "x".repeat(121) }] }),
      "$.nodes[0].title: text",
    ],
    [
      JSON.stringify({ ...example(), nodes: [{ ...example().nodes[0], choices: [] }] }),
      "$.nodes[0].choices: field",
    ],
    [
      JSON.stringify({
        ...example(),
        nodes: [{ id: "opening", type: "decision", prompt: "?", choices: [] }],
      }),
      "$.nodes[0].choices: choices",
    ],
    [
      JSON.stringify({ ...example(), nodes: [{ ...example().nodes[0], id: "__proto__" }] }),
      "$.nodes[0].id: id",
    ],
    [
      JSON.stringify({
        ...example(),
        assets: [{ ...example().assets[0], imagePrompt: "Look at @hero" }],
      }),
      "$.assets[0].imagePrompt: mention",
    ],
    [
      JSON.stringify({
        ...example(),
        nodes: [
          {
            ...example().nodes[0],
            storyboard: {
              clips: [
                {
                  id: "letter",
                  kind: "image",
                  title: "Letter",
                  durationMs: 2000,
                  prompt: "A letter with @hallway",
                },
              ],
            },
          },
          ...example().nodes.slice(1),
        ],
      }),
      "$.nodes[0].storyboard.clips[0].prompt: mention",
    ],
    [
      JSON.stringify({
        ...example(),
        nodes: [
          {
            ...example().nodes[0],
            storyboard: {
              clips: [
                {
                  id: "letter",
                  kind: "image",
                  title: "Letter",
                  durationMs: 100,
                  prompt: "Too short",
                },
              ],
            },
          },
          ...example().nodes.slice(1),
        ],
      }),
      "$.nodes[0].storyboard.clips[0].durationMs: duration",
    ],
    [
      JSON.stringify({
        ...example(),
        nodes: [{ ...example().nodes[0], storyboard: { clips: [], assetRefs: [] } }],
      }),
      "$.nodes[0].storyboard.assetRefs: field",
    ],
  ])("rejects invalid input with the exact failing path (%s)", (source, message) => {
    expect(() => parseStoryPlotImport(source)).toThrow(message);
  });

  it("accepts UTF-8 BOM and validates large connected files without recursion", () => {
    const source = JSON.stringify({
      entryNodeId: "s0",
      assets: [],
      nodes: Array.from({ length: 500 }, (_, i) => ({
        id: `s${i}`,
        type: "scene",
        title: `Scene ${i}`,
        next: i === 499 ? null : `s${i + 1}`,
      })),
    });
    const imported = applyStoryPlotImport(
      empty(),
      parseStoryPlotImport("\uFEFF" + source),
      "en-US"
    );
    expect(InteractiveStoryDraftContentSchema.safeParse(imported.content).success).toBe(true);
    expect(buildStoryCanvasModel(imported.content, "en-US").nodes).toHaveLength(500);
    expect(() => parseStoryPlotImport(" ".repeat(MAX_PLOT_IMPORT_BYTES + 1))).toThrow("size");
  });
  it("imports 5,000 connected nodes and long narrative text through the draft and canvas contracts", () => {
    const plot = parse({
      entryNodeId: "s0",
      assets: [],
      nodes: Array.from({ length: 5_000 }, (_, i) => ({
        id: `s${i}`,
        type: "scene",
        title: `Scene ${i}`,
        description: i === 0 ? "Long dialogue. ".repeat(6_000) : "",
        next: i === 4_999 ? null : `s${i + 1}`,
      })),
    });
    const imported = applyStoryPlotImport(empty(), plot, "en-US");
    expect(
      createLockableInteractiveStoryDraftContentSchema("en-US").safeParse(imported.content).success
    ).toBe(true);
    expect(buildStoryCanvasModel(imported.content, "en-US").nodes).toHaveLength(5_000);
    expect(() =>
      parse({
        ...plot,
        nodes: [...plot.nodes, { id: "overflow", type: "scene", title: "Overflow", next: null }],
      })
    ).toThrow("nodes");
  });
  it("accepts a single fenced JSON export and video filenames while rejecting media on image clips", () => {
    expect(
      parseStoryPlotImport("```json\n" + JSON.stringify(example()) + "\n```").nodes
    ).toHaveLength(3);
    const value = example();
    Object.assign(value.nodes[0]!.storyboard!.clips[1]!, { videoFile: "开场.mp4" });
    expect(parse(value).nodes[0]).toMatchObject({
      storyboard: { clips: [{}, { videoFile: "开场.mp4" }] },
    });
    Object.assign(value.nodes[0]!.storyboard!.clips[0]!, { videoFile: "still.mp4" });
    expect(() => parse(value)).toThrow("videoFile");
  });
});
