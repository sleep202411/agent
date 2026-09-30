import { expect, it } from "vitest";
import { CrewProductionDocumentSchema } from "./production-document-schema";
import { productionDocumentHtml } from "./production-document-html";
const id = "11111111-1111-4111-8111-111111111111";
const p = (text = "hello") => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});
const doc = (content: unknown[]) => ({ type: "doc", content });
it("retains structured tables, headings, lists, task checks and marks", () => {
  const html = productionDocumentHtml(
    doc([
      {
        type: "heading",
        attrs: { id, level: 2 },
        content: [{ type: "text", text: "Goal", marks: [{ type: "bold" }] }],
      },
      {
        type: "orderedList",
        attrs: { id, start: 3, type: "A" },
        content: [{ type: "listItem", content: [p()] }],
      },
      {
        type: "taskList",
        attrs: { id },
        content: [{ type: "taskItem", attrs: { checked: true }, content: [p()] }],
      },
      {
        type: "table",
        attrs: { id },
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { colspan: 2, rowspan: 1, colwidth: [100, 150] },
                content: [p()],
              },
            ],
          },
        ],
      },
    ])
  );
  expect(html).toContain("<strong>Goal</strong></h2>");
  expect(html).toContain('start="3" type="A"');
  expect(html).toContain("☑");
  expect(html).toContain('colspan="2" rowspan="1"');
  expect(html).toContain("width:250px");
});
it("escapes text and link attributes and creates no executable or navigable content", () => {
  const node = p('<img src=x onerror="alert(1)">');
  Object.assign(node.content[0], {
    marks: [{ type: "link", attrs: { href: 'https://example.com/" onclick="alert(1)' } }],
  });
  const html = productionDocumentHtml(doc([node]));
  expect(html).not.toContain("<img");
  expect(html).toContain('href="#" data-document-link="0"');
  expect(html).not.toContain('href="https://');
  expect(html).toContain("&lt;img");
  expect(html).toContain("&quot;");
  expect(html).toContain("default-src 'none'");
});
it.each([
  { value: undefined },
  { value: null },
  { value: {} },
  { value: doc([]) },
  { value: doc([{ type: "image", attrs: { src: "https://example.com" } }]) },
  { value: doc([{ ...p(), attrs: { id, backgroundColor: "red;display:none" } }]) },
])("rejects malformed or unsupported documents %j", ({ value }) => {
  expect(CrewProductionDocumentSchema.safeParse(value).success).toBe(false);
});
it("rejects deep, oversized and cyclic input without throwing from safeParse", () => {
  let node: unknown = p();
  for (let i = 0; i < 25; i++) node = { type: "blockquote", attrs: { id }, content: [node] };
  expect(CrewProductionDocumentSchema.safeParse(doc([node])).success).toBe(false);
  expect(CrewProductionDocumentSchema.safeParse(doc([p("中".repeat(250001))])).success).toBe(false);
  const cyclic: unknown[] = [];
  cyclic.push(cyclic);
  expect(CrewProductionDocumentSchema.safeParse(doc(cyclic)).success).toBe(false);
});
it("does not mutate persisted rich content when rendering", () => {
  const value = doc([p()]);
  const before = JSON.stringify(value);
  productionDocumentHtml(value);
  expect(JSON.stringify(value)).toBe(before);
});
