import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * TripleClickBlockSelection
 *
 * Notion-style triple-click. Triple-clicking inside any block selects the
 * entire block (paragraph, heading, code block, list-item paragraph, etc.)
 * as a `NodeSelection`, giving the whole block a rectangular highlight
 * via the `.ProseMirror-selectednode` style. This matches the visual
 * affordance Notion uses to signal "the whole block is selected" and
 * leaves the selection ready for block-level follow-ups: delete, drag,
 * duplicate, or replace by typing.
 */
export const TripleClickBlockSelection = Extension.create({
  name: "tripleClickBlockSelection",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("tripleClickBlockSelection"),
        props: {
          handleTripleClick: (view, pos) => {
            const { state } = view;
            const { doc } = state;
            const $pos = doc.resolve(pos);

            let depth = $pos.depth;
            while (depth > 0 && !$pos.node(depth).isTextblock) {
              depth--;
            }

            if (depth === 0) return false;

            const node = $pos.node(depth);
            if (node.type.spec.selectable === false) return false;

            const nodePos = $pos.before(depth);

            view.dispatch(state.tr.setSelection(NodeSelection.create(doc, nodePos)));
            return true;
          },
        },
      }),
    ];
  },
});
