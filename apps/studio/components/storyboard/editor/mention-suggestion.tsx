"use client";

import { ReactRenderer } from "@tiptap/react";
import tippy, { type Instance } from "tippy.js";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { MentionList, type MentionListRef } from "./mention-list";
import type { MentionItem, MentionType } from "./mention-node";

export function createMentionSuggestion(
  allItems: MentionItem[],
  allowedTypes?: MentionType[]
): Omit<SuggestionOptions<MentionItem>, "editor"> {
  return {
    items: ({ query }) => {
      const filtered = allowedTypes
        ? allItems.filter((item) => allowedTypes.includes(item.mentionType))
        : allItems;

      if (!query) return filtered.slice(0, 10);

      return filtered
        .filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 10);
    },

    render: () => {
      let component: ReactRenderer<MentionListRef> | null = null;
      let popup: Instance[] | null = null;

      return {
        onStart: (props: SuggestionProps<MentionItem>) => {
          component = new ReactRenderer(MentionList, {
            props: {
              items: props.items,
              command: (item: MentionItem) => {
                props.command({
                  id: item.id,
                  label: item.label,
                  mentionType: item.mentionType,
                  imgUrl: item.imgUrl,
                  voiceId: item.voiceId,
                  model: item.model,
                });
              },
            },
            editor: props.editor,
          });

          if (!props.clientRect) return;

          popup = tippy("body", {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
          });
        },

        onUpdate: (props: SuggestionProps<MentionItem>) => {
          component?.updateProps({
            items: props.items,
            command: (item: MentionItem) => {
              props.command({
                id: item.id,
                label: item.label,
                mentionType: item.mentionType,
                imgUrl: item.imgUrl,
                voiceId: item.voiceId,
                model: item.model,
              });
            },
          });

          if (props.clientRect && popup?.[0]) {
            popup[0].setProps({
              getReferenceClientRect: props.clientRect as () => DOMRect,
            });
          }
        },

        onKeyDown: (props: { event: KeyboardEvent }) => {
          if (props.event.key === "Escape") {
            popup?.[0]?.hide();
            return true;
          }
          return component?.ref?.onKeyDown(props) ?? false;
        },

        onExit: () => {
          popup?.[0]?.destroy();
          component?.destroy();
        },
      };
    },
  };
}
