import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  parseStoryPlotImport,
  parseStoryPlotImportValue,
  MAX_PLOT_IMPORT_BYTES,
} from "./story-plot-import";
const plot = () => ({
  entryNodeId: "start",
  assets: [],
  nodes: [{ id: "start", type: "scene", title: "Start", next: null }],
});
it("preserves valid plot data through normalized request validation", () => {
  const parsed = parseStoryPlotImport(JSON.stringify(plot()));
  expect(parseStoryPlotImportValue(parsed)).toEqual(parsed);
});
it.each(["en-US", "zh-CN", "zh-HK"])("accepts the official %s template", (locale) => {
  const md = readFileSync(
    resolve(process.cwd(), `../studio/public/templates/story-plot/${locale}.md`),
    "utf8"
  );
  const json = md.match(/```json\s*([\s\S]*?)```/)![1]!;
  const parsed = parseStoryPlotImport(json);
  expect(parsed.nodes.length).toBeGreaterThan(0);
  expect(parseStoryPlotImportValue(parsed)).toEqual(parsed);
});
it("rejects bad JSON, over-limit files and invalid graph targets", () => {
  expect(() => parseStoryPlotImport("oops")).toThrow();
  expect(() => parseStoryPlotImport(" ".repeat(MAX_PLOT_IMPORT_BYTES + 1))).toThrow();
  const value = plot();
  value.nodes[0]!.next = "absent" as never;
  expect(() => parseStoryPlotImportValue(value)).toThrow();
});
it("rejects duplicate and unreachable nodes", () => {
  const value = plot();
  value.nodes.push({ ...value.nodes[0]! });
  expect(() => parseStoryPlotImportValue(value)).toThrow();
  value.nodes[1]!.id = "unreachable";
  expect(() => parseStoryPlotImportValue(value)).toThrow();
});
