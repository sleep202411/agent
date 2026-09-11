import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyStoryPlotImport,
  MAX_PLOT_IMPORT_BYTES,
  parseStoryPlotImport,
} from "../app/[locale]/story-studio/_components/project-canvas/story-plot-import";
import { buildStoryCanvasModel } from "../app/[locale]/story-studio/_components/project-canvas/story-project-canvas-model";
import { StoryCanvasHistory } from "../app/[locale]/story-studio/_components/project-canvas/story-canvas-history";
import {
  InteractiveStoryDraftContentSchema,
  createLockableInteractiveStoryDraftContentSchema,
} from "../../server/src/story-studio/interactive-film.schema";
import type { InteractiveStoryDraftContent } from "./story-projects-api";

const empty = (): InteractiveStoryDraftContent => ({
  storyBible: { logline: "Existing logline", synopsis: "", characters: [] },
  graph: { entryNodeId: null, nodes: [] },
  productionNotes: ["Keep this"],
});
const example = () => ({
  version: 1,
  entryNodeId: "opening",
  nodes: [
    {
      id: "opening",
      type: "scene",
      title: "Opening",
      description: "  第一行\n“保留原文” 🎬  ",
      next: "choice",
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
        new URL(`../public/templates/story-plot/${locale}.md`, import.meta.url),
        "utf8"
      );
      const json = md.match(/```json\n([\s\S]+?)\n```/)![1]!;
      const { content } = applyStoryPlotImport(empty(), parseStoryPlotImport(json), locale);
      expect(
        createLockableInteractiveStoryDraftContentSchema(locale).safeParse(content).success
      ).toBe(true);
      expect(buildStoryCanvasModel(content, locale).nodes).toHaveLength(4);
    }
  );

  it("preserves exact copy, ordered choices, rejoining branches, entry and terminal nodes through the server schema", () => {
    const result = applyStoryPlotImport(empty(), parse(example()), "zh-CN");
    const saved = InteractiveStoryDraftContentSchema.parse(result.content);
    expect(saved).toEqual(result.content);
    expect(saved.graph.entryNodeId).toBe(saved.graph.nodes[0]!.nodeId);
    expect(saved.graph.nodes[0]).toMatchObject({
      description: example().nodes[0]!.description,
      exit: { nextNodeId: saved.graph.nodes[1]!.nodeId },
    });
    expect(saved.graph.nodes[1]).toMatchObject({
      exit: {
        prompt: { "zh-CN": "走哪条路？" },
        choices: [
          { label: { "zh-CN": "左" }, nextNodeId: saved.graph.nodes[2]!.nodeId },
          { label: { "zh-CN": "右" }, nextNodeId: saved.graph.nodes[2]!.nodeId },
        ],
      },
    });
    expect(saved.graph.nodes[2]).toMatchObject({ exit: { kind: "auto", nextNodeId: null } });
    const model = buildStoryCanvasModel(result.content, "zh-CN");
    expect(model.nodes).toHaveLength(3);
    expect(model.edges).toHaveLength(3);
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
    ["```json\n{}\n```", "$: json"],
    [JSON.stringify({ ...example(), version: 2 }), "$.version: version"],
    [JSON.stringify({ ...example(), metadata: "must not vanish" }), "$.metadata: field"],
    [JSON.stringify({ ...example(), entryNodeId: "missing" }), "$.entryNodeId: target"],
    [JSON.stringify({ ...example(), nodes: [] }), "$.nodes: nodes"],
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
  ])("rejects invalid input with the exact failing path (%s)", (source, message) => {
    expect(() => parseStoryPlotImport(source)).toThrow(message);
  });

  it("accepts UTF-8 BOM and validates large connected files without recursion", () => {
    const source = JSON.stringify({
      version: 1,
      entryNodeId: "s0",
      nodes: Array.from({ length: 1000 }, (_, i) => ({
        id: `s${i}`,
        type: "scene",
        title: `Scene ${i}`,
        next: i === 999 ? null : `s${i + 1}`,
      })),
    });
    const imported = applyStoryPlotImport(
      empty(),
      parseStoryPlotImport("\uFEFF" + source),
      "en-US"
    );
    expect(InteractiveStoryDraftContentSchema.safeParse(imported.content).success).toBe(true);
    expect(buildStoryCanvasModel(imported.content, "en-US").nodes).toHaveLength(1000);
    expect(() => parseStoryPlotImport(" ".repeat(MAX_PLOT_IMPORT_BYTES + 1))).toThrow("size");
  });
});
