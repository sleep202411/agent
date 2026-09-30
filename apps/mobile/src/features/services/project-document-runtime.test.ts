import { afterEach, expect, it, vi } from "vitest";
import { startEditor } from "../../../document-editor/runtime";
import { CrewProductionDocumentSchema } from "./production-document-schema";
import type { Editor, JSONContent } from "@tiptap/core";
const id = "11111111-1111-4111-8111-111111111111";
let editor: Editor | undefined;
let root: HTMLElement;
function start(content: unknown[]) {
  root = document.createElement("main");
  root.innerHTML =
    "<button data-save></button><div data-toolbar></div><input data-value hidden><button data-apply hidden></button><div data-status></div><div data-editor></div>";
  document.body.append(root);
  const emit = vi.fn();
  editor = startEditor(
    root,
    { type: "doc", content },
    { invalid: "Invalid", save: "Save", saving: "Saving" },
    emit
  );
  return emit;
}
afterEach(() => {
  editor?.destroy();
  editor = undefined;
  root?.remove();
});
it("roundtrips canonical rich structures without losing text or formatting", async () => {
  start([
    {
      type: "heading",
      attrs: {
        id,
        level: 2,
        indent: 2,
        backgroundColor: "#123456",
        nodeTextAlign: "right",
        nodeVerticalAlign: "middle",
      },
      content: [
        {
          type: "text",
          text: "Goal",
          marks: [{ type: "bold" }, { type: "textStyle", attrs: { color: "#abcdef" } }],
        },
      ],
    },
    {
      type: "table",
      attrs: { id: "22222222-2222-4222-8222-222222222222" },
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              attrs: { colspan: 1, rowspan: 1, colwidth: [150], align: "right" },
              content: [
                {
                  type: "paragraph",
                  attrs: { id: "33333333-3333-4333-8333-333333333333" },
                  content: [{ type: "emoji", attrs: { name: "smile" } }],
                },
              ],
            },
          ],
        },
      ],
    },
  ]);
  await vi.waitFor(() =>
    expect(CrewProductionDocumentSchema.safeParse(editor!.getJSON()).success).toBe(true)
  );
  const json = editor!.getJSON() as JSONContent;
  expect(json.content![0].attrs).toMatchObject({
    indent: 2,
    backgroundColor: "#123456",
    nodeTextAlign: "right",
    nodeVerticalAlign: "middle",
  });
  expect(json.content![1].content![0].content![0].attrs).toMatchObject({
    colwidth: [150],
    align: "right",
  });
});
it("captures latest content on save and locks further submissions", () => {
  const emit = start([
    { type: "paragraph", attrs: { id }, content: [{ type: "text", text: "First" }] },
  ]);
  editor!.commands.setTextSelection(6);
  editor!.commands.insertContent(" latest");
  root.querySelector<HTMLButtonElement>("[data-save]")!.click();
  const saves = emit.mock.calls.map((c) => c[0]).filter((v) => v.type === "save");
  expect(saves).toHaveLength(1);
  expect(JSON.stringify(saves[0])).toContain("First latest");
  expect(editor!.isEditable).toBe(false);
  root.querySelector<HTMLButtonElement>("[data-save]")!.click();
  expect(emit.mock.calls.filter((c) => c[0].type === "save")).toHaveLength(1);
});
it("creates canonical new table and heading blocks", async () => {
  start([{ type: "paragraph", attrs: { id } }]);
  editor!.commands.toggleHeading({ level: 3 });
  editor!.commands.insertContent("Heading");
  editor!.commands.insertContent({ type: "paragraph" });
  editor!.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
  await vi.waitFor(() =>
    expect(CrewProductionDocumentSchema.safeParse(editor!.getJSON()).success).toBe(true)
  );
});
